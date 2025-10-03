const IntegrationModel = require("../../models/integrations.model");
const { ExecuteCampaign } = require("../../utils/common");
const shopifyCustomerSyncQueue = require("../../queues/shopifycustomer_sync.queue");
const { ObjectId } = require("mongodb");
const { MoleculerError } = require("moleculer").Errors;
const axios = require("axios"); // Import axios
const { PubSub } = require("@google-cloud/pubsub"); // Import PubSub
const path = require("path");
const dotenv = require("dotenv");
const CustomerModel = require("../../models/customer.model"); // Import CustomerModel
const CampaignModel = require("../../models/flow/campaign.model"); // Import CampaignModel
dotenv.config();

"use strict";

module.exports = {
    name: "shopify",

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {

        syncShopifyCustomers: {
            auth: "required",
            /**
             * Handles the initiation of Shopify customer synchronization for a specific branch and organization.
             *
             * This method:
             * - Retrieves the Shopify integration configuration for the given branch and organization.
             * - Validates the existence of the integration and its access token.
             * - Adds a customer sync job to the Shopify customer sync queue.
             * - Returns a success response if the job is initiated, or an error response if any step fails.
             *
             * @async
             * @param {Context} ctx - Moleculer context object containing metadata.
             * @param {string} ctx.meta.branch_id - The unique identifier of the branch.
             * @param {string} ctx.meta.org_id - The unique identifier of the organization.
             * @returns {Promise<Object>} Response object with status and message.
             *   - {number} status - HTTP-like status code (202 for success, 500 for failure).
             *   - {string} message - Description of the result.
             *   - {string} [error] - Error message if the operation fails.
             *
             * @throws {MoleculerError} If the Shopify integration is not found or the access token is missing.
             */
            async handler(ctx) {
                const { branch_id, org_id } = ctx.meta;

                try {
                    const integration = await IntegrationModel.findOne({ branch_id: new ObjectId(branch_id), org_id: new ObjectId(org_id), name: "Shopify" });
                    console.log(branch_id, org_id);
                    if (!integration || !integration.config.access_token) {
                        throw new MoleculerError("Shopify integration not found or access token missing", 404, "SHOPIFY_INTEGRATION_NOT_FOUND");
                    }

                    await shopifyCustomerSyncQueue.add('syncCustomers', {
                        shop_domain: integration.config.shop_domain,
                        access_token: integration.config.access_token,
                        branch_id,
                        org_id
                    });

                    return { status: 202, message: "Shopify customer sync initiated successfully." };
                } catch (error) {
                    this.logger.error("Error initiating Shopify customer sync:", error);
                    return { status: 500, message: "Failed to initiate Shopify customer sync", error: error.message };
                }
            }
        },

        ProcessShopifyEvents: {
            auth: false,
            rest: {
                method: "POST",
                path: "/shopify-data-process"
            },
            /**
             * Handles incoming Shopify webhook events from HTTP requests.
             *
             * - Processes the incoming webhook data directly.
             * - Determines the Shopify event topic from headers or data.
             * - Maps the topic to the corresponding handler method.
             * - Returns a status message indicating success or failure.
             *
             * @param {Context} ctx - Moleculer context object containing the webhook data.
             * @param {Object} ctx.params - The webhook payload.
             * @returns {Object} Status object indicating processing result.
             */
            async handler(ctx) {
                // Get Shopify headers from the request - handle both meta and direct access
                const headers = ctx.meta?.headers || ctx.meta || {};
                const topic = headers['x-shopify-topic'] || headers['X-Shopify-Topic'];
                const shopDomain = headers['x-shopify-shop-domain'] || headers['X-Shopify-Shop-Domain'];
                
                console.log("🛒 Processing Shopify order:", ctx.params.id || ctx.params.order_number);
                console.log("Processing Task:", topic);
                console.log("Shop Domain:", shopDomain);
                console.log("Available headers:", Object.keys(headers));
                console.log("Order Data:", JSON.stringify(ctx.params, null, 2));
                
                // Create a mock message object for the ProcessShopifyEvents method
                const message = {
                    data: Buffer.from(JSON.stringify(ctx.params)).toString('base64'),
                    attributes: {
                        "X-Shopify-Topic": topic || "orders/create",
                        "X-Shopify-Shop-Domain": shopDomain || "reviewbit-test.myshopify.com"
                    }
                };
                
                return await this.ProcessShopifyEvents(message);
            }
        },
    },

    /**
     * Events
     */
    events: {
        "shopify.integrated": {
            /**
             * Handles the integration of a Shopify store by saving its credentials and registering necessary webhooks.
             *
             * @async
             * @param {Context} ctx - Moleculer context object containing parameters.
             * @param {string} ctx.params.shop_domain - The domain of the Shopify store to integrate.
             * @param {string} ctx.params.access_token - The access token for authenticating with the Shopify API.
             * @returns {Promise<void>} Resolves when webhooks are successfully registered.
             *
             * @example
             * // Example usage within a Moleculer action
             * await broker.call("integration.shopify.handler", {
             *   shop_domain: "example.myshopify.com",
             *   access_token: "shpat_1234567890abcdef"
             * });
             *
             * @throws {Error} Throws if webhook registration fails.
             */
            async handler(ctx) {
                const { shop_domain, access_token } = ctx.params;
                this.logger.info(`Shopify integration saved for ${shop_domain}. Registering webhooks..., access_token: ${access_token}`);
                await this.registerShopifyWebhooks(shop_domain, access_token);
            },
        },
    },

    /**
     * Methods
     */
    methods: {
        async ProcessShopifyEvents(message) {
            const taskData = message;
            // Extract the Shopify event topic from message attributes
            const Topic = message.attributes["X-Shopify-Topic"];
            if (!Topic) {
                console.log("Invalid Task Data:", JSON.stringify(taskData));
                return {
                    status: 400,
                    message: "Invalid Task Data"
                };
            }
            // // Decode the base64-encoded event payload
            const Base64Data = message.data;
            let JsonData = Buffer.from(Base64Data, "base64").toString("utf-8");
            const shop = message.attributes["X-Shopify-Shop-Domain"];

            // // Find integration by shop domain to get branch_id and org_id
            const integration = await IntegrationModel.findOne({ "config.shop_domain": shop });
            if (!integration) {
                console.log(`Integration not found for shop domain: ${shop}`);
                return { status: 404, message: "Shopify integration not found" };
            }
            // console.log(integration)
            const branch_id = integration.branch_id;
            const org_id = integration.org_id;

            console.log("Processing Task:", Topic);

            // Dispatch event to appropriate handler based on topic
            switch (Topic) {
                case "orders/create":
                    this.ProcessOrdersCreate(JSON.parse(JsonData), branch_id, org_id, shop);
                    break;
                case "orders/paid":
                    this.ProcessOrdersPaid(JSON.parse(JsonData), branch_id, org_id, shop);
                    break;
                case "orders/cancelled":
                    this.ProcessOrdersCancelled(JSON.parse(JsonData), branch_id, org_id, shop);
                    break;
                case "checkouts/create":
                    this.ProcessCheckoutsCreate(JSON.parse(JsonData), branch_id, org_id, shop);
                    break;
                case "fulfillments/create":
                    this.ProcessFulfillmentsCreate(JSON.parse(JsonData), branch_id, org_id, shop);
                    break;
                case "products/update":
                    this.ProcessProductsUpdate(JSON.parse(JsonData), branch_id, org_id, shop);
                    break;
                default:
                    // Unhandled topic
                    break;
            }
            return {
                status: 200,
                message: "Task Processed Successfully"
            };
        },

        /**
         * Registers Shopify webhooks for the given shop domain and access token.
         *
         * This method:
         * - Iterates through all defined webhook topics.
         * - For each topic, creates a Pub/Sub webhook subscription using Shopify's GraphQL API.
         * - Logs the result of each registration attempt.
         * - Waits 1 second between registrations to avoid rate limiting.
         *
         * @param {string} shop_domain - The Shopify shop domain.
         * @param {string} access_token - The Shopify API access token.
         * @returns {Promise<void>} Resolves when all webhooks are registered.
         */
        async registerShopifyWebhooks(shop_domain, access_token) {
            try {
                this.logger.info(`Registering webhooks for shop: ${shop_domain}`);
                // Construct Shopify GraphQL API URL
                const apiUrl = `https://${shop_domain}/admin/api/${process.env.GRAPQL_VERSION}/graphql.json`;
                const apiToken = access_token;

                if (!apiToken) {
                    this.logger.error("API Token not found for webhook registration.");
                    return;
                }

                // Iterate over all webhook topics and register each
                for (const { pubSubTopic, shopifyTopic } of WehbookTopic) {
                    // Prepare webhook subscription payload for Shopify
                    const webhookSubscription = {
                        pubSubProject: process.env.GCP_PROJECT_ID,
                        pubSubTopic,
                        format: "JSON",
                    };

                    try {
                        // Call Shopify GraphQL mutation to register webhook
                        const response = await pubSubWebhookSubscriptionCreate(
                            apiUrl,
                            apiToken,
                            shopifyTopic,
                            webhookSubscription
                        );
                        this.logger.info(
                            `${shopifyTopic} webhook registered with Pub/Sub topic "${pubSubTopic}":`,
                            response
                        );
                    } catch (error) {
                        this.logger.error(
                            `Error registering ${shopifyTopic} webhook with Pub/Sub topic "${pubSubTopic}":`,
                            error?.response?.data || error?.message
                        );
                    }
                    // Wait for 1 second before registering the next webhook to avoid rate limits
                    await delay(1000);
                }
                this.logger.info("All webhooks registered successfully");
            } catch (error) {
                this.logger.error("Error registering webhooks:", error);
            }
        },

        async ProcessOrdersCreate(orderData, branch_id, org_id, shop) {
            this.logger.info(`Processing order creation for shop: ${shop}, branch: ${branch_id}, org: ${org_id}, order: ${orderData.id}`);

            try {
                // Process the order using the new order processor service
                const result = await this.broker.call("order-processor.processNewOrder", {
                    orderData: orderData,
                    customerData: orderData.customer,
                    orgId: org_id,
                    branchId: branch_id
                });

                this.logger.info(`Order ${orderData.id} processed successfully:`, result);
                
                return {
                    success: true,
                    message: "Order processed successfully",
                    data: result.data
                };

            } catch (error) {
                this.logger.error("Error processing order creation:", error);
                
                // You might want to implement retry logic or dead letter queue here
                return {
                    success: false,
                    message: "Failed to process order",
                    error: error.message
                };
            }
        },

        async ProcessOrdersCancelled(orderData, branch_id, org_id, shop) {
            this.logger.info(`Processing order cancellation for shop: ${shop}, branch: ${branch_id}, org: ${org_id}, order: ${orderData.id}`);

            try {
                // Process the order cancellation using the order processor service
                const cancellationResult = await this.broker.call("order-processor.processOrderCancellation", {
                    orderData: orderData,
                    customerData: orderData.customer,
                    orgId: org_id,
                    branchId: branch_id
                });

                this.logger.info(`Order ${orderData.id} cancellation processed successfully:`, cancellationResult);

                // Check if any products from the cancelled order are now back in stock
                // and trigger back-in-stock notifications for subscribed customers
                let backInStockProcessed = false;
                if (orderData.line_items && orderData.line_items.length > 0) {
                    this.logger.info(`Checking for back-in-stock opportunities from cancelled order: ${orderData.id}`);
                    
                    try {
                        // Process each line item to check if it's back in stock
                        for (const lineItem of orderData.line_items) {
                            if (lineItem.product_id) {
                                // Get current product data to check inventory
                                const productData = await this.getProductData(lineItem.product_id, shop);
                                
                                if (productData && productData.variants) {
                                    // Check if any variants are back in stock (≥5 units)
                                    const backInStockVariants = [];
                                    
                                    for (const variant of productData.variants) {
                                        if (variant.inventory_quantity >= 5) {
                                            backInStockVariants.push({
                                                variant_id: variant.id,
                                                variant_title: variant.title,
                                                inventory_quantity: variant.inventory_quantity,
                                                price: variant.price
                                            });
                                        }
                                    }

                                    // If we have variants back in stock, trigger notifications
                                    if (backInStockVariants.length > 0) {
                                        this.logger.info(`Product ${productData.id} has ${backInStockVariants.length} variants back in stock due to order cancellation`);
                                        
                                        const backInStockResult = await this.broker.call("order-processor.processBackInStock", {
                                            productData: productData,
                                            backInStockVariants: backInStockVariants,
                                            orgId: org_id,
                                            branchId: branch_id,
                                            shopDomain: shop
                                        });

                                        this.logger.info(`Back-in-stock notifications processed for product ${productData.id}:`, backInStockResult);
                                        backInStockProcessed = true;
                                    }
                                }
                            }
                        }
                    } catch (backInStockError) {
                        this.logger.error("Error processing back-in-stock notifications from cancellation:", backInStockError);
                        // Don't fail the cancellation process if back-in-stock processing fails
                    }
                }
                
                return {
                    success: true,
                    message: "Order cancellation processed successfully",
                    data: {
                        cancellation: cancellationResult.data,
                        backInStockProcessed: backInStockProcessed
                    }
                };

            } catch (error) {
                this.logger.error("Error processing order cancellation:", error);
                
                // You might want to implement retry logic or dead letter queue here
                return {
                    success: false,
                    message: "Failed to process order cancellation",
                    error: error.message
                };
            }
        },

        /**
         * Process order paid event from Shopify
         */
        async ProcessOrdersPaid(orderData, branch_id, org_id, shop) {
            this.logger.info(`Processing order paid for shop: ${shop}, branch: ${branch_id}, org: ${org_id}, order: ${orderData.id}`);

            try {
                // Process the order confirmation using the order processor service
                const result = await this.broker.call("order-processor.processNewOrder", {
                    orderData: orderData,
                    customerData: orderData.customer,
                    orgId: org_id,
                    branchId: branch_id
                });

                this.logger.info(`Order ${orderData.id} paid event processed successfully:`, result);
                
                return {
                    success: true,
                    message: "Order paid event processed successfully",
                    data: result.data
                };

            } catch (error) {
                this.logger.error("Error processing order paid event:", error);
                
                // You might want to implement retry logic or dead letter queue here
                return {
                    success: false,
                    message: "Failed to process order paid event",
                    error: error.message
                };
            }
        },

        async ProcessCheckoutsCreate(checkoutData, branch_id, org_id, shop) {
            let formattedData = {
                total_price: checkoutData?.total_price,
                abandoned_checkout_url: checkoutData?.abandoned_checkout_url,
                line_items: checkoutData?.line_items,
                cart_token: checkoutData?.cart_token,
                id: checkoutData?.id,
                shipping_lines: checkoutData?.shipping_lines,
                shipping_address: checkoutData?.shipping_address,
            }
        },

        /**
         * Process product update events for back-in-stock notifications
         */
        async ProcessProductsUpdate(productData, branch_id, org_id, shop) {
            this.logger.info(`Processing product update for shop: ${shop}, branch: ${branch_id}, org: ${org_id}, product: ${productData.id}`);

            try {
                // Check if any variants have inventory >= 5 (back in stock threshold)
                const backInStockVariants = [];
                
                if (productData.variants && Array.isArray(productData.variants)) {
                    for (const variant of productData.variants) {
                        if (variant.inventory_quantity >= 5) {
                            backInStockVariants.push({
                                variant_id: variant.id,
                                variant_title: variant.title,
                                inventory_quantity: variant.inventory_quantity,
                                price: variant.price
                            });
                        }
                    }
                }

                // If we have variants back in stock, trigger notifications
                if (backInStockVariants.length > 0) {
                    this.logger.info(`Product ${productData.id} has ${backInStockVariants.length} variants back in stock`);
                    
                    // Call the back-in-stock processor service
                    const result = await this.broker.call("order-processor.processBackInStock", {
                        productData: productData,
                        backInStockVariants: backInStockVariants,
                        orgId: org_id,
                        branchId: branch_id,
                        shopDomain: shop
                    });

                    this.logger.info(`Back-in-stock notifications processed for product ${productData.id}:`, result);
                    
                    return {
                        success: true,
                        message: "Back-in-stock notifications processed successfully",
                        data: result.data
                    };
                } else {
                    this.logger.info(`Product ${productData.id} updated but no variants meet back-in-stock threshold`);
                    return {
                        success: true,
                        message: "Product updated but no back-in-stock notifications needed",
                        data: { variants_checked: productData.variants?.length || 0 }
                    };
                }

            } catch (error) {
                this.logger.error("Error processing product update:", error);
                
                return {
                    success: false,
                    message: "Failed to process product update",
                    error: error.message
                };
            }
        },

        /**
         * Checks and creates required Pub/Sub topics for Shopify event integration.
         *
         * This method:
         * - Iterates through all defined webhook topics in the WehbookTopic array.
         * - For each topic, checks if the corresponding Pub/Sub topic exists in Google Cloud.
         * - If the topic does not exist, creates it.
         * - Logs the result of each check and creation attempt.
         * - Skips any topic if its name is not defined in environment variables.
         *
         * @returns {Promise<void>} Resolves when all topics are checked and created as needed.
         */
        async createPubSubTopics() {
            this.logger.info("Checking and creating Pub/Sub topics...");
            for (const { pubSubTopic } of WehbookTopic) {
                const topicName = pubSubTopic;
                if (!topicName) {
                    this.logger.warn("Pub/Sub topic name is not defined in environment variables.");
                    continue;
                }
                try {
                    // Get the Pub/Sub topic reference
                    const topic = this.pubsub.topic(topicName);
                    // Check if the topic exists
                    const [exists] = await topic.exists();
                    if (!exists) {
                        // Create the topic if it does not exist
                        await topic.create();
                        this.logger.info(`Pub/Sub topic '${topicName}' created.`);
                    } else {
                        this.logger.info(`Pub/Sub topic '${topicName}' already exists.`);
                    }
                } catch (error) {
                    this.logger.error(`Error checking/creating Pub/Sub topic '${topicName}':`, error);
                }
            }
            this.logger.info("Finished checking and creating Pub/Sub topics.");
        },

        /**
         * Sets up Google Pub/Sub subscriptions for Shopify webhook events.
         *
         * Iterates through the list of webhook topics defined in `WehbookTopic`, and for each topic:
         * - Checks if the corresponding Pub/Sub topic exists.
         * - Creates a subscription for the topic if it does not already exist.
         * - Attaches message and error event listeners to the subscription.
         *   - On receiving a message, processes the Shopify event using `ProcessShopifyEvents`.
         *   - Acknowledges the message if processed successfully, otherwise nacks the message.
         * - Logs relevant information and warnings throughout the process.
         *
         * @async
         * @returns {Promise<void>} Resolves when all subscriptions are set up.
         *
         * @throws {Error} Logs and continues on errors encountered during setup for individual topics.
         *
         * @example
         * await this.subscribeToShopifyEvents();
         */
        async subscribeToShopifyEvents() {
            this.logger.info("Setting up Pub/Sub subscriptions for Shopify events...");
            for (const { pubSubTopic, shopifyTopic } of WehbookTopic) {
                const topicName = pubSubTopic;
                if (!topicName) {
                    this.logger.warn(`Pub/Sub topic name for ${shopifyTopic} is not defined.`);
                    continue;
                }

                const subscriptionName = `${topicName}-sub`; // Derive subscription name from topic name
                try {
                    const topic = this.pubsub.topic(topicName);
                    const [topicExists] = await topic.exists();
                    if (!topicExists) {
                        this.logger.warn(`Pub/Sub topic '${topicName}' does not exist. Skipping subscription setup.`);
                        continue;
                    }

                    const subscription = topic.subscription(subscriptionName);
                    const [subExists] = await subscription.exists();
                    if (!subExists) {
                        await topic.createSubscription(subscriptionName);
                        this.logger.info(`Pub/Sub subscription '${subscriptionName}' created for topic '${topicName}'.`);
                    } else {
                        this.logger.info(`Pub/Sub subscription '${subscriptionName}' already exists for topic '${topicName}'.`);
                    }

                    subscription.on('message', async (message) => {
                        this.logger.info(`Received message from subscription '${subscriptionName}': ${message.id}`);
                        try {
                            // Call the ProcessShopifyEvents method with the message
                            await this.ProcessShopifyEvents(message);
                            message.ack(); // Acknowledge the message
                            this.logger.info(`Message ${message.id} acknowledged.`);
                        } catch (error) {
                            console.log(error)
                            // this.logger.error(`Error processing message ${message.id} from subscription '${subscriptionName}':`, error);
                            message.nack(); // Nack the message if processing fails
                        }
                    });

                    subscription.on('error', (error) => {
                        this.logger.error(`Error on subscription '${subscriptionName}':`, error);
                    });

                    this.logger.info(`Listening for messages on subscription '${subscriptionName}' for topic '${topicName}'.`);

                } catch (error) {
                    this.logger.error(`Error setting up subscription for topic '${topicName}':`, error);
                }
            }
            this.logger.info("Finished setting up Pub/Sub subscriptions.");
        },

        /**
         * Get product data from Shopify API
         * @param {string} productId - Shopify product ID
         * @param {string} shopDomain - Shopify shop domain
         * @returns {Object} Product data with variants and inventory
         */
        async getProductData(productId, shopDomain) {
            try {
                this.logger.info(`Fetching product data for product: ${productId} from shop: ${shopDomain}`);
                
                // Get shop integration data to get access token
                const shopIntegration = await this.broker.call("integration.getShopIntegration", {
                    shop_domain: shopDomain
                });
                
                if (!shopIntegration || !shopIntegration.access_token) {
                    this.logger.error(`No access token found for shop: ${shopDomain}`);
                    return null;
                }
                
                const accessToken = shopIntegration.access_token;
                const apiUrl = `https://${shopDomain}/admin/api/2023-10/products/${productId}.json`;
                
                const axios = require('axios');
                const response = await axios.get(apiUrl, {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.data && response.data.product) {
                    this.logger.info(`Successfully fetched product data for: ${productId}`);
                    return response.data.product;
                } else {
                    this.logger.warn(`No product data found for: ${productId}`);
                    return null;
                }
                
            } catch (error) {
                this.logger.error(`Error fetching product data for ${productId}:`, error);
                return null;
            }
        }
    },

    /**
     * Service lifecycle events
     */
    created() {
        this.logger.info("Shopify service created");
    },

    started() {
        const projectRoot = path.resolve(__dirname, "..");
        const keyFilename = path.join(projectRoot, "../gcp/service_account.json");
        this.pubsub = new PubSub({ keyFilename, projectId: process.env.GCP_PROJECT_ID });
        this.createPubSubTopics();
        this.subscribeToShopifyEvents(); // Start listening to Pub/Sub events
    },

    stopped() {
        this.logger.info("Shopify service stopped");
    },
};

// Define the WebhookTopic interface and array
const WehbookTopic = [
    { pubSubTopic: process.env.ORDERS_CREATE, shopifyTopic: "ORDERS_CREATE" },
    // { pubSubTopic: process.env.ORDERS_DELETE, shopifyTopic: "ORDERS_DELETE" },
    {
        pubSubTopic: process.env.ORDERS_CANCELLED,
        shopifyTopic: "ORDERS_CANCELLED",
    },
    // { pubSubTopic: process.env.ORDERS_EDITED, shopifyTopic: "ORDERS_EDITED" },
    // {
    //     pubSubTopic: process.env.ORDERS_FULFILLED,
    //     shopifyTopic: "ORDERS_FULFILLED",
    // },
    // { pubSubTopic: process.env.ORDERS_PAID, shopifyTopic: "ORDERS_PAID" },
    // { pubSubTopic: process.env.ORDERS_UPDATED, shopifyTopic: "ORDERS_UPDATED" },
    // {
    //     pubSubTopic: process.env.CUSTOMERS_CREATE,
    //     shopifyTopic: "CUSTOMERS_CREATE",
    // },
    // {
    //     pubSubTopic: process.env.CUSTOMERS_UPDATE,
    //     shopifyTopic: "CUSTOMERS_UPDATE",
    // },
    // {
    //     pubSubTopic: process.env.CUSTOMERS_DELETE,
    //     shopifyTopic: "CUSTOMERS_DELETE",
    // },
    // { pubSubTopic: process.env.CARTS_CREATE, shopifyTopic: "CARTS_CREATE" },
    // { pubSubTopic: process.env.CARTS_UPDATE, shopifyTopic: "CARTS_UPDATE" },
    // {
    //     pubSubTopic: process.env.DISCOUNTS_CREATE,
    //     shopifyTopic: "DISCOUNTS_CREATE",
    // },
    // {
    //     pubSubTopic: process.env.DISCOUNTS_DELETE,
    //     shopifyTopic: "DISCOUNTS_DELETE",
    // },
    // {
    //     pubSubTopic: process.env.DISCOUNTS_UPDATE,
    //     shopifyTopic: "DISCOUNTS_UPDATE",
    // },
    // {
    //     pubSubTopic: process.env.PRODUCTS_CREATE,
    //     shopifyTopic: "PRODUCTS_CREATE",
    // },
    // {
    //     pubSubTopic: process.env.PRODUCTS_DELETE,
    //     shopifyTopic: "PRODUCTS_DELETE",
    // },
    // {
    //     pubSubTopic: process.env.PRODUCTS_UPDATE,
    //     shopifyTopic: "PRODUCTS_UPDATE",
    // },
    // {
    //     pubSubTopic: process.env.FULFILLMENTS_CREATE,
    //     shopifyTopic: "FULFILLMENTS_CREATE",
    // },
    // // {
    // //     pubSubTopic: process.env.FULFILLMENTS_UPDATE,
    // //     shopifyTopic: "FULFILLMENTS_UPDATE",
    // // },
    // {
    //     pubSubTopic: process.env.INVENTORY_ITEMS_CREATE,
    //     shopifyTopic: "INVENTORY_ITEMS_CREATE",
    // },
    // {
    //     pubSubTopic: process.env.INVENTORY_ITEMS_DELETE,
    //     shopifyTopic: "INVENTORY_ITEMS_DELETE",
    // },
    // {
    //     pubSubTopic: process.env.INVENTORY_ITEMS_UPDATE,
    //     shopifyTopic: "INVENTORY_ITEMS_UPDATE",
    // },
    // {
    //     pubSubTopic: process.env.CHECKOUTS_CREATE,
    //     shopifyTopic: "CHECKOUTS_CREATE",
    // },
    // {
    //     pubSubTopic: process.env.CHECKOUTS_DELETE,
    //     shopifyTopic: "CHECKOUTS_DELETE",
    // },
    // {
    //     pubSubTopic: process.env.CHECKOUTS_UPDATE,
    //     shopifyTopic: "CHECKOUTS_UPDATE",
    // },
    // {
    //     pubSubTopic: process.env.DRAFT_ORDERS_CREATE,
    //     shopifyTopic: "DRAFT_ORDERS_CREATE",
    // },
    // {
    //     pubSubTopic: process.env.DRAFT_ORDERS_UPDATE,
    //     shopifyTopic: "DRAFT_ORDERS_UPDATE",
    // },
    // {
    //     pubSubTopic: process.env.DRAFT_ORDERS_DELETE,
    //     shopifyTopic: "DRAFT_ORDERS_DELETE",
    // },
];

async function pubSubWebhookSubscriptionCreate(
    apiUrl,
    apiToken,
    topic,
    webhookSubscription
) {
    const query = `
        mutation pubSubWebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: PubSubWebhookSubscriptionInput!) {
            pubSubWebhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
                webhookSubscription {
                    id
                    topic
                    format
                    endpoint {
                        __typename
                        ... on WebhookPubSubEndpoint {
                            pubSubProject
                            pubSubTopic
                        }
                    }
                }
            }
        }
    `;

    const variables = {
        topic: topic,
        webhookSubscription: webhookSubscription,
    };

    try {
        const response = await axios.post(
            apiUrl,
            {
                query,
                variables,
            },
            {
                headers: {
                    "X-Shopify-Access-Token": `${apiToken}`,
                },
            }
        );
        return response.data;
    } catch (error) {
        console.error(
            "Error in pubSubWebhookSubscriptionCreate:",
            error?.response?.data || error?.message
        );
        throw error;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
