const mongoose = require('mongoose');
require('dotenv').config();

async function checkPhoneNumbers() {
    try {
        console.log('🔍 Checking phone numbers in database...');
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');
        
        // Check channels
        const ChannelModel = require('./models/channel.model');
        const channels = await ChannelModel.find({
            deleted: { $ne: true }
        });
        
        console.log(`\n📱 Found ${channels.length} WhatsApp channels:`);
        channels.forEach((channel, index) => {
            console.log(`\nChannel ${index + 1}:`);
            console.log(`  ID: ${channel._id}`);
            console.log(`  Org ID: ${channel.org_id}`);
            console.log(`  Phone: ${channel.phone_number_details?.display_phone_number}`);
            console.log(`  WABA ID: ${channel.waba_id}`);
            console.log(`  Health: ${channel.health}`);
            console.log(`  Deleted: ${channel.deleted}`);
        });
        
        // Check if we have any orders
        const OrderModel = require('./models/orders.model');
        const orders = await OrderModel.find().limit(5);
        
        console.log(`\n📦 Found ${orders.length} recent orders:`);
        orders.forEach((order, index) => {
            console.log(`\nOrder ${index + 1}:`);
            console.log(`  ID: ${order._id}`);
            console.log(`  Shopify Order ID: ${order.shopify_order_id}`);
            console.log(`  Customer Phone: ${order.customer_phone}`);
            console.log(`  Customer Name: ${order.customer_name}`);
            console.log(`  Total: ${order.total_amount}`);
        });
        
        await mongoose.disconnect();
        console.log('\n✅ Database check completed');
        
    } catch (error) {
        console.error('❌ Database check failed:', error.message);
    }
}

checkPhoneNumbers();
