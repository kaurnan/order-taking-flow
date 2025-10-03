const { Worker } = require('bullmq');
const Redis = require('ioredis');
const axios = require('axios');
const dotenv = require('dotenv');
const { connectMongo } = require('../../mixins/db');
const Customer = require('../../models/customer.model');
const { FormatPhoneNumber } = require('../../utils/common');
const Tag = require('../../models/tag.model');

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);

connection.options.maxRetriesPerRequest = null;

(async () => {
    await connectMongo();
    console.log("Mongo ready for shopifycustomer_sync");
})().catch(err => {
    console.error("Mongo connect error (shopifycustomer_sync):", err);
    process.exit(1);
});

// Helper: Fetch all Shopify customers
async function fetchAllShopifyCustomers(shopDomain, accessToken, pageInfo = null, customers = []) {
    const url = `https://${shopDomain}/admin/api/2025-07/customers.json${pageInfo ? `?page_info=${pageInfo}&limit=250` : '?limit=250'}`;

    const response = await axios.get(url, {
        headers: {
            'X-Shopify-Access-Token': accessToken,
        }
    });

    const newCustomers = response.data.customers;
    customers.push(...newCustomers);

    const linkHeader = response.headers.link;
    const nextLinkMatch = linkHeader && linkHeader.match(/<([^>]+)>; rel="next"/);
    if (nextLinkMatch) {
        const nextUrl = new URL(nextLinkMatch[1]);
        const nextPageInfo = nextUrl.searchParams.get('page_info');
        return fetchAllShopifyCustomers(shopDomain, accessToken, nextPageInfo, customers);
    }

    return customers;
}

// Helper: Save customer to MongoDB
async function saveCustomerToDB(customerData, branchId, orgId, broker) { // Add broker to parameters
    try {

        let tags = customerData.tags ? customerData.tags.split(',').map(tag => tag.trim()) : [];
        // Find Tag ObjectIds from Tag model if they exist
        let tagObjectIds = [];
        if (tags.length > 0) {
            tagObjectIds = await Tag.find({ name: { $in: tags }, org_id: orgId, branch_id: branchId }, '_id').lean();
            tagObjectIds = tagObjectIds.map(tag => tag._id);
        }

        let payload = {
            name: customerData.first_name + ' ' + customerData.last_name,
            email: customerData.email,
            phone: customerData.phone,
            branch_id: branchId,
            org_id: orgId,
            // Initial meta, will be populated by dynamicfield service
            meta: {}
        };

        // Populate meta field using dynamicfield service
        payload = await broker.call('dynamicfield.populateCustomerMeta', {
            customerData: {
                orders_count: customerData.orders_count,
                total_spent: Number(customerData.total_spent) || 0,
                last_order_id: customerData.last_order_id?.toString(),
                last_order_name: customerData.last_order_name,
                admin_graphql_api_id: customerData.admin_graphql_api_id,
                currency: customerData.currency // Assuming currency is available in customerData
            },
            branchId: branchId,
            platform: 'shopify'
        });

        const formattedPhone = customerData.phone ? FormatPhoneNumber(customerData.phone ?? customerData.default_address?.phone, customerData.default_address?.country_code) : null;
        const existing = await Customer.findOne({ phone: formattedPhone, branch_id: branchId, org_id: orgId });

        if (existing) {
            await Customer.updateOne({ _id: existing._id }, payload);
        } else {
            await Customer.create(payload);
        }
    } catch (err) {
        console.error('Error saving customer:', err.message);
    }
}

// BullMQ Worker
const shopifyCustomerSyncWorker = new Worker(
    'shopify-customer-sync',
    async (job) => {
        const { shop_domain, access_token, branch_id, org_id } = job.data;
        console.log(`🔄 Starting sync for shop: ${shop_domain}`);

        // Access the broker from the worker's parent service context
        const broker = job.worker.opts.connection.broker; // Assuming broker is passed via connection options or similar

        try {
            const customers = await fetchAllShopifyCustomers(shop_domain, access_token);
            console.log(`📦 Total customers fetched: ${customers.length}`);

            for (const customer of customers) {
                await saveCustomerToDB(customer, branch_id, org_id, broker); // Pass broker to saveCustomerToDB
            }

            console.log(`✅ Sync complete for shop: ${shop_domain}`);
        } catch (err) {
            console.error(`❌ Sync failed for ${shop_domain}:`, err.message);
        }
    },
    { connection }
);

module.exports = shopifyCustomerSyncWorker;
