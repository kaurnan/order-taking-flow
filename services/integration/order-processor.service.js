"use strict";

const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");

module.exports = {
    name: "order-processor",
    mixins: [dbMixin("orders")],
    
    settings: {
        // Order processing configuration
        maxRetries: 3,
        retryDelay: 5000, // 5 seconds
        workflowTimeout: 300000 // 5 minutes
    },
    
    actions: {
        /**
         * Process new order from Shopify
         */
        processNewOrder: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/process-order"
            },
            params: {
                orderData: "object",
                customerData: "object",
                orgId: { type: "any" }, // Accept both string and ObjectId
                branchId: { type: "any" } // Accept both string and ObjectId
            },
            async handler(ctx) {
                const { orderData, customerData, orgId, branchId } = ctx.params;
                
                // Convert ObjectIds to strings if needed
                const orgIdStr = orgId.toString();
                const branchIdStr = branchId ? branchId.toString() : null;
                
                try {
                    this.logger.info(`Processing new order: ${orderData.id} for org: ${orgIdStr}`);
                    
                    // Step 1: Validate order data
                    const validatedOrder = await this.validateOrderData(orderData);
                    
                    // Step 2: Check if order already processed
                    const existingOrder = await this.checkExistingOrder(validatedOrder.id, orgIdStr);
                    if (existingOrder) {
                        this.logger.warn(`Order ${validatedOrder.id} already processed`);
                        return {
                            success: true,
                            message: "Order already processed",
                            data: existingOrder
                        };
                    }
                    
                    // Step 3: Create order record
                    const orderRecord = await this.createOrderRecord(validatedOrder, orgIdStr, branchIdStr);
                    
                    // Step 4: Get or create customer
                    const customer = await this.getOrCreateCustomer(customerData, orgIdStr, branchIdStr);
                    
                    // Step 5: Start Temporal workflow
                    const workflowResult = await this.startOrderConfirmationWorkflow(
                        validatedOrder, 
                        customer, 
                        { orgId, branchId }
                    );
                    
                    // Step 6: Update order record with workflow info
                    await this.updateOrderWithWorkflow(orderRecord._id, workflowResult);
                    
                    return {
                        success: true,
                        message: "Order processed successfully",
                        data: {
                            orderId: orderRecord._id,
                            workflowId: workflowResult.workflowId,
                            customerId: customer._id
                        }
                    };
                    
                } catch (error) {
                    this.logger.error("Error processing order:", error);
                    throw new MoleculerError("Failed to process order", 500, "ORDER_PROCESSING_ERROR");
                }
            }
        },
        
        /**
         * Get order processing status
         */
        getOrderStatus: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/order-status/:orderId"
            },
            params: {
                orderId: "string"
            },
            async handler(ctx) {
                const { orderId } = ctx.params;
                const { orgId, branchId } = ctx.meta;
                
                try {
                    const order = await this.adapter.findById(orderId);
                    
                    if (!order || order.org_id !== orgId || order.branch_id !== branchId) {
                        throw new MoleculerError("Order not found", 404, "ORDER_NOT_FOUND");
                    }
                    
                    return {
                        success: true,
                        data: {
                            orderId: order._id,
                            shopifyOrderId: order.shopify_order_id,
                            status: order.status,
                            workflowId: order.workflow_id,
                            workflowStatus: order.workflow_status,
                            messageSent: order.message_sent,
                            createdAt: order.created_at,
                            updatedAt: order.updated_at
                        }
                    };
                    
                } catch (error) {
                    this.logger.error("Error getting order status:", error);
                    throw new MoleculerError("Failed to get order status", 500, "ORDER_STATUS_ERROR");
                }
            }
        },
        
        /**
         * Retry failed order processing
         */
        retryOrderProcessing: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/retry-order/:orderId"
            },
            params: {
                orderId: "string"
            },
            async handler(ctx) {
                const { orderId } = ctx.params;
                const { orgId, branchId } = ctx.meta;
                
                try {
                    const order = await this.adapter.findById(orderId);
                    
                    if (!order || order.org_id !== orgId || order.branch_id !== branchId) {
                        throw new MoleculerError("Order not found", 404, "ORDER_NOT_FOUND");
                    }
                    
                    if (order.status === "completed") {
                        throw new MoleculerError("Order already completed", 400, "ORDER_ALREADY_COMPLETED");
                    }
                    
                    // Reset order status and retry
                    await this.adapter.updateById(orderId, {
                        $set: {
                            status: "processing",
                            retry_count: (order.retry_count || 0) + 1,
                            updated_at: new Date()
                        }
                    });
                    
                    // Get customer data
                    const customer = await ctx.call("customer.getSingleAudience", {
                        id: order.customer_id
                    });
                    
                    // Retry workflow
                    const workflowResult = await this.startOrderConfirmationWorkflow(
                        order.order_data,
                        customer.data,
                        { orgId, branchId }
                    );
                    
                    return {
                        success: true,
                        message: "Order processing retried successfully",
                        data: {
                            orderId: order._id,
                            workflowId: workflowResult.workflowId,
                            retryCount: order.retry_count + 1
                        }
                    };
                    
                } catch (error) {
                    this.logger.error("Error retrying order processing:", error);
                    throw new MoleculerError("Failed to retry order processing", 500, "ORDER_RETRY_ERROR");
                }
            }
        },

        /**
         * Process order cancellation
         */
        processOrderCancellation: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/process-order-cancellation"
            },
            params: {
                orderData: "object",
                customerData: "object",
                orgId: { type: "any" },
                branchId: { type: "any" }
            },
            async handler(ctx) {
                const { orderData, customerData, orgId, branchId } = ctx.params;

                // Convert ObjectIds to strings if needed
                const orgIdStr = orgId.toString();
                const branchIdStr = branchId ? branchId.toString() : null;

                try {
                    this.logger.info(`Processing order cancellation: ${orderData.id} for org: ${orgIdStr}`);

                    // Step 1: Validate order data
                    const validatedOrder = await this.validateOrderData(orderData);

                    // Step 2: Find existing order (optional - proceed even if not found)
                    const existingOrder = await this.findExistingOrder(validatedOrder.id, orgIdStr);
                    let updatedOrder = null;

                    if (existingOrder) {
                        // Step 3: Update order status to cancelled if order exists
                        updatedOrder = await this.updateOrderStatus(existingOrder._id, "cancelled");
                        this.logger.info(`Order ${validatedOrder.id} status updated to cancelled`);
                    } else {
                        this.logger.warn(`Order ${validatedOrder.id} not found in database, but proceeding with cancellation notification`);
                    }

                    // Step 4: Get customer data
                    const customer = await this.getOrCreateCustomer(customerData, orgIdStr, branchIdStr);

                    // Step 5: Start Temporal workflow for cancellation notification (always proceed)
                    const workflowResult = await this.startOrderCancellationWorkflow(
                        validatedOrder,
                        customer,
                        { orgId, branchId }
                    );

                    // Step 6: Update order record with workflow info (only if order exists)
                    if (updatedOrder) {
                        await this.updateOrderWithWorkflow(updatedOrder._id, workflowResult);
                    }

                    return {
                        success: true,
                        message: existingOrder ?
                            "Order cancellation processed successfully" :
                            "Order cancellation notification sent (order not found in database)",
                        data: {
                            order: updatedOrder,
                            workflow: workflowResult,
                            orderFound: !!existingOrder
                        }
                    };

                } catch (error) {
                    this.logger.error("Error processing order cancellation:", error);
                    throw new Error(`Failed to process order cancellation: ${error.message}`);
                }
            }
        },

        /**
         * Send WhatsApp cancellation message endpoint
         */
        sendWhatsAppCancellation: {
            rest: {
                method: "POST",
                path: "/sendWhatsAppCancellation"
            },
            params: {
                orderData: "object",
                customerData: "object",
                orgData: "object"
            },
            async handler(ctx) {
                const { orderData, customerData, orgData } = ctx.params;

                try {
                    this.logger.info(`Sending WhatsApp cancellation message for order: ${orderData.id}`);

                    // Call the order cancellation template service
                    const result = await this.broker.call("order-cancellation-template.sendOrderCancellationMessage", {
                        orderData: orderData,
                        customerData: customerData,
                        orgId: orgData.orgId,
                        branchId: orgData.branchId
                    });

                    this.logger.info(`WhatsApp cancellation message sent successfully for order: ${orderData.id}`);

                    return {
                        success: true,
                        message: "WhatsApp cancellation message sent successfully",
                        data: result
                    };

                } catch (error) {
                    this.logger.error("Error sending WhatsApp cancellation message:", error);
                    throw new Error(`Failed to send WhatsApp cancellation message: ${error.message}`);
                }
            }
        },

        /**
         * Send WhatsApp message for order confirmation
         */
        sendWhatsAppMessage: {
            // This REST endpoint is only for Temporal activities to call
            rest: {
                method: "POST",
                path: "/sendWhatsAppMessage"
            },
            params: {
                orderData: "object",
                customerData: "object",
                orgData: "object"
            },
            async handler(ctx) {
                const { orderData, customerData, orgData } = ctx.params;

                try {
                    this.logger.info(`Sending WhatsApp message for order: ${orderData.id}`);
                    this.logger.info(`Customer phone: ${customerData.phone}`);
                    this.logger.info(`Order data structure:`, {
                        id: orderData.id,
                        order_number: orderData.order_number,
                        name: orderData.name,
                        total_price: orderData.total_price,
                        totalPrice: orderData.totalPrice,
                        line_items: orderData.line_items?.length || 0,
                        lineItems: orderData.lineItems?.length || 0
                    });

                    // Find available WhatsApp channel
                    const availableChannel = await this.findAvailableWhatsAppChannel(orgData.orgId);
                    if (!availableChannel) {
                        throw new Error("No WhatsApp channel available");
                    }

                    this.logger.info(`Using WhatsApp channel: ${availableChannel._id} (WABA: ${availableChannel.waba_id})`);

                    // Get the order confirmation template from database
                    const template = await this.broker.call("order-confirmation-template.getOrderConfirmationTemplateByName", {
                        name: "order_confirmation",
                        orgId: orgData.orgId,
                        branchId: orgData.branchId
                    }).catch(() => null);

                    let whatsappResult;

                    if (!template) {
                        this.logger.error("Order confirmation template not found! Cannot send template message.");
                        throw new Error("Order confirmation template not found. Please create an approved template first.");
                    } else {
                        this.logger.info(`Using approved template: ${template.name} (${template.whatsapp_template_id || template._id})`);
                        
                        // Prepare template parameters based on the actual template structure
                        const bodyParams = [
                            customerData.name || "Customer",
                            orderData.order_number || orderData.name || orderData.id,
                            orderData.line_items?.map(item => `${item.name} (${item.quantity}x)`).join(", ") || orderData.lineItems?.map(item => `${item.name} (${item.quantity}x)`).join(", ") || "Items", // Items is 3rd
                            orderData.total_price || orderData.totalPrice || "0" // Total is 4th
                        ];
                        
                        this.logger.info(`Template parameters - Body only: ${JSON.stringify(bodyParams)}`);
                        this.logger.info(`Parameter mapping: {{1}}=${bodyParams[0]}, {{2}}=${bodyParams[1]}, {{3}}=${bodyParams[2]}, {{4}}=${bodyParams[3]}`);
                        
                        // Send WhatsApp message using the template from database
                        whatsappResult = await this.broker.call("whatsapp.SendMsgViaBSP", {
                        to: customerData.phone,
                        // contact_id is optional - using customer's database ID if available, otherwise omit
                        ...(customerData._id && { contact_id: parseInt(customerData._id.toString().slice(-8), 16) }),
                        message_type: "template",
                        meta_payload: {
                                name: template.name,
                                language: {
                                    code: template.language
                                },
                                components: template.components
                            },
                            template_data: {
                                components: [
                                    {
                                        type: "BODY",
                                        parameters: [
                                            {
                                                type: "text",
                                                text: customerData.name || "Customer"
                                            },
                                            {
                                                type: "text",
                                                text: orderData.order_number || orderData.name || orderData.id
                                            },
                                            {
                                                type: "text",
                                                text: orderData.total_price || orderData.totalPrice || "0"
                                            },
                                            {
                                                type: "text",
                                                text: orderData.line_items?.map(item => `${item.name} (${item.quantity}x)`).join(", ") || orderData.lineItems?.map(item => `${item.name} (${item.quantity}x)`).join(", ") || "Items"
                                            }
                                        ]
                                    }
                                ]
                        },
                        channel_id: availableChannel._id.toString(),
                        channel: {
                            bsp: "interakt",
                            waba_id: availableChannel.waba_id
                        }
                    });
                    }

                    this.logger.info(`WhatsApp message sent successfully: ${whatsappResult?.messageId || 'text message'}`);

                    return {
                        success: true,
                        messageId: whatsappResult?.messageId || 'text message',
                        phone: customerData.phone,
                        channel: availableChannel._id.toString()
                    };

                } catch (error) {
                    this.logger.error("Error sending WhatsApp message:", error);
                    throw new MoleculerError(`Failed to send WhatsApp message: ${error.message}`, 500, "WHATSAPP_SEND_ERROR");
                }
            }
        },

        /**
         * Process back-in-stock notifications
         */
        processBackInStock: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/process-back-in-stock"
            },
            params: {
                productData: "object",
                backInStockVariants: "array",
                orgId: { type: "any" },
                branchId: { type: "any" },
                shopDomain: "string"
            },
            async handler(ctx) {
                const { productData, backInStockVariants, orgId, branchId, shopDomain } = ctx.params;
                
                try {
                    this.logger.info(`Processing back-in-stock notifications for product: ${productData.id}`);
                    
                    // Get all active subscriptions for this product
                    const subscriptions = await this.getBackInStockSubscriptions(productData.id, orgId);
                    
                    if (subscriptions.length === 0) {
                        this.logger.info(`No active subscriptions found for product: ${productData.id}`);
                        return {
                            success: true,
                            message: "No subscriptions to notify",
                            data: { subscriptions_notified: 0 }
                        };
                    }
                    
                    // Start Temporal workflow for back-in-stock notifications
                    const workflowResult = await this.startBackInStockWorkflow(
                        productData,
                        backInStockVariants,
                        subscriptions,
                        { orgId, branchId, shopDomain }
                    );
                    
                    return {
                        success: true,
                        message: "Back-in-stock notifications processed successfully",
                        data: {
                            productId: productData.id,
                            variantsBackInStock: backInStockVariants.length,
                            subscriptionsNotified: subscriptions.length,
                            workflowId: workflowResult.workflowId
                        }
                    };
                    
                } catch (error) {
                    this.logger.error("Error processing back-in-stock notifications:", error);
                    throw new MoleculerError("Failed to process back-in-stock notifications", 500, "BACK_IN_STOCK_ERROR");
                }
            }
        },

        /**
         * Subscribe customer to back-in-stock notifications
         */
        subscribeBackInStock: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/subscribe-back-in-stock"
            },
            params: {
                productId: "string",
                productTitle: "string",
                variantId: { type: "string", optional: true },
                variantTitle: { type: "string", optional: true },
                customerEmail: { type: "string", optional: true },
                customerPhone: { type: "string", optional: true },
                customerName: { type: "string", optional: true },
                orgId: { type: "any" },
                branchId: { type: "any", optional: true },
                shopDomain: "string"
            },
            async handler(ctx) {
                const { 
                    productId, 
                    productTitle, 
                    variantId, 
                    variantTitle, 
                    customerEmail, 
                    customerPhone, 
                    customerName,
                    orgId, 
                    branchId, 
                    shopDomain 
                } = ctx.params;
                
                try {
                    // Validate that at least email or phone is provided
                    if (!customerEmail && !customerPhone) {
                        throw new MoleculerError("Either email or phone number is required", 400, "MISSING_CONTACT_INFO");
                    }
                    
                    // Check if subscription already exists
                    const existingSubscription = await this.checkExistingSubscription(
                        productId, 
                        variantId, 
                        customerEmail, 
                        customerPhone, 
                        orgId
                    );
                    
                    if (existingSubscription) {
                        return {
                            success: true,
                            message: "Subscription already exists",
                            data: existingSubscription
                        };
                    }
                    
                    // Create new subscription
                    const subscription = await this.createBackInStockSubscription({
                        productId,
                        productTitle,
                        variantId,
                        variantTitle,
                        customerEmail,
                        customerPhone,
                        customerName,
                        orgId,
                        branchId,
                        shopDomain
                    });
                    
                    return {
                        success: true,
                        message: "Successfully subscribed to back-in-stock notifications",
                        data: subscription
                    };
                    
                } catch (error) {
                    this.logger.error("Error subscribing to back-in-stock notifications:", error);
                    throw new MoleculerError("Failed to subscribe to back-in-stock notifications", 500, "SUBSCRIPTION_ERROR");
                }
            }
        },

        /**
         * Send back-in-stock notifications to subscribed customers
         */
        sendBackInStockNotifications: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/send-back-in-stock-notifications"
            },
            params: {
                productData: "object",
                backInStockVariants: "array",
                subscriptions: "array",
                orgData: "object"
            },
            async handler(ctx) {
                const { productData, backInStockVariants, subscriptions, orgData } = ctx.params;
                
                try {
                    this.logger.info(`Sending back-in-stock notifications for product: ${productData.id}`);
                    this.logger.info(`Notifying ${subscriptions.length} subscribers`);
                    
                    const results = [];
                    let successCount = 0;
                    let failureCount = 0;
                    
                    // Send notification to each subscriber
                    for (const subscription of subscriptions) {
                        try {
                            // Only send to subscribers with phone numbers
                            if (!subscription.customer_phone) {
                                this.logger.warn(`Skipping subscription ${subscription._id} - no phone number`);
                                continue;
                            }
                            
                            // Find available WhatsApp channel
                            const availableChannel = await this.findAvailableWhatsAppChannel(orgData.orgId);
                            if (!availableChannel) {
                                throw new Error("No WhatsApp channel available");
                            }
                            
                            // Prepare customer data for WhatsApp
                            const customerData = {
                                _id: subscription._id,
                                name: subscription.customer_name || "Customer",
                                phone: subscription.customer_phone,
                                email: subscription.customer_email
                            };
                            
                            // Create product link
                            const productLink = `https://${orgData.shopDomain}/products/${productData.handle || productData.id}`;
                            
                            // Send WhatsApp message
                            const whatsappResult = await this.broker.call("whatsapp.SendMsgViaBSP", {
                                to: subscription.customer_phone,
                                contact_id: subscription._id,
                                message_type: "template",
                                meta_payload: {
                                    template_name: "back_in_stock_notification",
                                    template_data: {
                                        customer_name: subscription.customer_name || "Customer",
                                        product_name: productData.title,
                                        product_link: productLink,
                                        variant_info: backInStockVariants.length > 0 ? 
                                            backInStockVariants.map(v => v.variant_title).join(", ") : 
                                            "Multiple variants"
                                    }
                                },
                                channel_id: availableChannel._id.toString(),
                                channel: {
                                    bsp: "interakt",
                                    waba_id: availableChannel.waba_id
                                }
                            });
                            
                            // Update subscription status
                            await this.updateSubscriptionNotificationStatus(subscription._id, true);
                            
                            results.push({
                                subscriptionId: subscription._id,
                                customerPhone: subscription.customer_phone,
                                success: true,
                                messageId: whatsappResult.messageId
                            });
                            
                            successCount++;
                            this.logger.info(`✅ Notification sent to ${subscription.customer_phone} for product ${productData.id}`);
                            
                        } catch (error) {
                            this.logger.error(`❌ Failed to send notification to ${subscription.customer_phone}:`, error);
                            
                            results.push({
                                subscriptionId: subscription._id,
                                customerPhone: subscription.customer_phone,
                                success: false,
                                error: error.message
                            });
                            
                            failureCount++;
                        }
                    }
                    
                    return {
                        success: true,
                        message: `Back-in-stock notifications processed: ${successCount} sent, ${failureCount} failed`,
                        data: {
                            productId: productData.id,
                            totalSubscriptions: subscriptions.length,
                            successCount: successCount,
                            failureCount: failureCount,
                            results: results
                        }
                    };
                    
                } catch (error) {
                    this.logger.error("Error sending back-in-stock notifications:", error);
                    throw new MoleculerError("Failed to send back-in-stock notifications", 500, "NOTIFICATION_SEND_ERROR");
                }
            }
        }
    },
    
    methods: {
        /**
         * Validate order data
         */
        async validateOrderData(orderData) {
            if (!orderData || !orderData.id) {
                throw new Error("Invalid order data: missing order ID");
            }
            
            if (!orderData.line_items || orderData.line_items.length === 0) {
                throw new Error("Invalid order data: no line items found");
            }
            
            if (!orderData.customer) {
                throw new Error("Invalid order data: missing customer information");
            }
            
            return orderData;
        },
        
        /**
         * Check if order already exists
         */
        async checkExistingOrder(shopifyOrderId, orgId) {
            return await this.adapter.findOne({
                shopify_order_id: shopifyOrderId,
                org_id: orgId
            });
        },
        
        /**
         * Create order record in database
         */
        async createOrderRecord(orderData, orgId, branchId) {
            const orderRecord = {
                shopify_order_id: orderData.id,
                order_number: orderData.order_number || orderData.name,
                customer_name: orderData.customer?.first_name + " " + orderData.customer?.last_name,
                customer_email: orderData.customer?.email,
                customer_phone: orderData.customer?.phone,
                total_amount: orderData.total_price,
                currency: orderData.currency,
                items: orderData.line_items.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    total: item.quantity * item.price
                })),
                shipping_address: orderData.shipping_address,
                status: "processing",
                org_id: orgId,
                branch_id: branchId,
                order_data: orderData, // Store full order data
                created_at: new Date(),
                updated_at: new Date()
            };
            
            return await this.adapter.insert(orderRecord);
        },
        
        /**
         * Get or create customer
         */
        async getOrCreateCustomer(customerData, orgId, branchId) {
            try {
                // For now, create a simple customer record directly
                // This bypasses the customer service dependency issue
                
                const customerName = `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim() || 'Unknown Customer';
                
                // Create a simple customer object that we can use
                const customer = {
                    _id: new ObjectId(), // Generate a new ObjectId
                    name: customerName,
                    email: customerData.email,
                    phone: customerData.phone,
                    org_id: new ObjectId(orgId),
                    branch_id: new ObjectId(branchId),
                    created_at: new Date(),
                    updated_at: new Date()
                };
                
                this.logger.info(`Created customer record for order: ${customerName} (${customerData.email})`);
                
                return customer;
                
            } catch (error) {
                this.logger.error("Error getting or creating customer:", error);
                throw error;
            }
        },
        
        /**
         * Start Temporal workflow for order confirmation
         */
        async startOrderConfirmationWorkflow(orderData, customerData, orgData) {
            try {
                this.logger.info(`Starting order confirmation workflow for order: ${orderData.id}`);
                this.logger.info(`Customer: ${customerData.name} (${customerData.email})`);
                this.logger.info(`Order total: ${orderData.currency} ${orderData.total_price}`);
                
                // Call the Temporal Gateway via HTTP
                this.logger.info("🔧 Attempting to call Temporal workflow via HTTP...");
                
                const axios = require('axios');
                const temporalGatewayUrl = process.env.TEMPORAL_GATEWAY_URL || 'http://localhost:3002';
                
                const response = await axios.post(`${temporalGatewayUrl}/exec-shopify`, {
                    name: "OrderConfirmationWorkflow",
                    orderData: orderData,
                    customerData: customerData,
                    orgData: orgData
                });
                
                this.logger.info(`✅ Order confirmation workflow started: ${response.data.workflowId}`);
                
                return response.data;
                
            } catch (error) {
                this.logger.error("Error starting Temporal workflow:", error);
                throw new Error(`Failed to start order confirmation workflow: ${error.message}`);
            }
        },

        /**
         * Start Temporal workflow for order cancellation
         */
        async startOrderCancellationWorkflow(orderData, customerData, orgData) {
            try {
                this.logger.info(`Starting order cancellation workflow for order: ${orderData.id}`);
                this.logger.info(`Customer: ${customerData.name} (${customerData.email})`);
                this.logger.info(`Order total: ${orderData.currency} ${orderData.total_price}`);

                // Call the Temporal Gateway via HTTP
                this.logger.info("🔧 Attempting to call Temporal cancellation workflow via HTTP...");

                const axios = require('axios');
                const temporalGatewayUrl = process.env.TEMPORAL_GATEWAY_URL || 'http://localhost:3002';

                const response = await axios.post(`${temporalGatewayUrl}/exec-shopify-cancellation`, {
                    name: "OrderCancellationWorkflow",
                    orderData: orderData,
                    customerData: customerData,
                    orgData: orgData
                });

                this.logger.info(`✅ Order cancellation workflow started: ${response.data.workflowId}`);

                return response.data;

            } catch (error) {
                this.logger.error("Error starting Temporal cancellation workflow:", error);
                throw new Error(`Failed to start order cancellation workflow: ${error.message}`);
            }
        },

        /**
         * Find existing order by Shopify order ID
         */
        async findExistingOrder(shopifyOrderId, orgId) {
            return await this.adapter.findOne({
                shopify_order_id: shopifyOrderId,
                org_id: orgId
            });
        },

        /**
         * Update order status
         */
        async updateOrderStatus(orderId, status) {
            return await this.adapter.updateById(orderId, {
                $set: {
                    status: status,
                    updated_at: new Date()
                }
            });
        },
        
        /**
         * Update order record with workflow information
         */
        async updateOrderWithWorkflow(orderId, workflowResult) {
            await this.adapter.updateById(orderId, {
                $set: {
                    workflow_id: workflowResult.workflowId,
                    workflow_status: "started",
                    updated_at: new Date()
                }
            });
        },

        /**
         * Find available WhatsApp channel for organization
         */
        async findAvailableWhatsAppChannel(orgId) {
            try {
                // Get channels directly from the database to avoid authentication issues
                const channels = await this.broker.call("channel.getChannelsDirect", {
                    orgId: orgId
                });

                if (!channels || !channels.data || channels.data.length === 0) {
                    this.logger.warn(`No channels found for org: ${orgId}`);
                    return null;
                }

                // Use specific channel ID: 684b0f27325b7471155bf081
                const specificChannelId = "684b0f27325b7471155bf081";
                const whatsappChannel = channels.data.find(channel => 
                    channel._id.toString() === specificChannelId &&
                    channel.deleted !== true
                );

                if (!whatsappChannel) {
                    this.logger.warn(`No suitable WhatsApp channel found for org: ${orgId}`);
                    this.logger.warn(`Available channels: ${channels.data.map(c => c.phone_number_details?.display_phone_number).join(', ')}`);
                    return null;
                }

                this.logger.info(`Using WhatsApp channel: ${whatsappChannel._id} (BSP: ${whatsappChannel.bsp}, Phone: ${whatsappChannel.phone_number_details?.display_phone_number}) for org: ${orgId}`);
                return whatsappChannel;

            } catch (error) {
                this.logger.error("Error finding WhatsApp channel:", error);
                return null;
            }
        },

        /**
         * Get back-in-stock subscriptions for a product
         */
        async getBackInStockSubscriptions(productId, orgId) {
            try {
                const BackInStockSubscription = require("../../models/back-in-stock-subscriptions.model");
                
                const subscriptions = await BackInStockSubscription.find({
                    product_id: productId,
                    org_id: orgId,
                    status: "active"
                });

                this.logger.info(`Found ${subscriptions.length} active subscriptions for product: ${productId}`);
                return subscriptions;

            } catch (error) {
                this.logger.error("Error getting back-in-stock subscriptions:", error);
                return [];
            }
        },

        /**
         * Check if subscription already exists
         */
        async checkExistingSubscription(productId, variantId, customerEmail, customerPhone, orgId) {
            try {
                const BackInStockSubscription = require("../../models/back-in-stock-subscriptions.model");
                
                const query = {
                    product_id: productId,
                    org_id: orgId,
                    status: "active"
                };

                // Add variant filter if provided
                if (variantId) {
                    query.variant_id = variantId;
                }

                // Check by email or phone
                if (customerEmail) {
                    query.customer_email = customerEmail;
                } else if (customerPhone) {
                    query.customer_phone = customerPhone;
                }

                const existingSubscription = await BackInStockSubscription.findOne(query);
                return existingSubscription;

            } catch (error) {
                this.logger.error("Error checking existing subscription:", error);
                return null;
            }
        },

        /**
         * Create back-in-stock subscription
         */
        async createBackInStockSubscription(subscriptionData) {
            try {
                const BackInStockSubscription = require("../../models/back-in-stock-subscriptions.model");
                
                const subscription = new BackInStockSubscription({
                    product_id: subscriptionData.productId,
                    product_title: subscriptionData.productTitle,
                    variant_id: subscriptionData.variantId,
                    variant_title: subscriptionData.variantTitle,
                    customer_email: subscriptionData.customerEmail,
                    customer_phone: subscriptionData.customerPhone,
                    customer_name: subscriptionData.customerName,
                    shopify_shop_domain: subscriptionData.shopDomain,
                    org_id: subscriptionData.orgId,
                    branch_id: subscriptionData.branchId,
                    status: "active",
                    min_stock_threshold: 5
                });

                const savedSubscription = await subscription.save();
                this.logger.info(`Created back-in-stock subscription: ${savedSubscription._id}`);
                
                return savedSubscription;

            } catch (error) {
                this.logger.error("Error creating back-in-stock subscription:", error);
                throw error;
            }
        },

        /**
         * Start Temporal workflow for back-in-stock notifications
         */
        async startBackInStockWorkflow(productData, backInStockVariants, subscriptions, orgData) {
            try {
                this.logger.info(`Starting back-in-stock workflow for product: ${productData.id}`);
                this.logger.info(`Notifying ${subscriptions.length} subscribers`);
                
                // Call the Temporal Gateway via HTTP
                this.logger.info("🔧 Attempting to call Temporal back-in-stock workflow via HTTP...");
                
                const axios = require('axios');
                const temporalGatewayUrl = process.env.TEMPORAL_GATEWAY_URL || 'http://localhost:3002';
                
                const response = await axios.post(`${temporalGatewayUrl}/exec-back-in-stock`, {
                    name: "BackInStockWorkflow",
                    productData: productData,
                    backInStockVariants: backInStockVariants,
                    subscriptions: subscriptions,
                    orgData: orgData
                });
                
                this.logger.info(`✅ Back-in-stock workflow started: ${response.data.workflowId}`);
                
                return response.data;
                
            } catch (error) {
                this.logger.error("Error starting Temporal back-in-stock workflow:", error);
                throw new Error(`Failed to start back-in-stock workflow: ${error.message}`);
            }
        },

        /**
         * Update subscription notification status
         */
        async updateSubscriptionNotificationStatus(subscriptionId, notificationSent) {
            try {
                const BackInStockSubscription = require("../../models/back-in-stock-subscriptions.model");
                
                const updateData = {
                    notification_sent: notificationSent,
                    updated_at: new Date()
                };
                
                if (notificationSent) {
                    updateData.notification_sent_at = new Date();
                    updateData.status = "notified";
                }
                
                const updatedSubscription = await BackInStockSubscription.findByIdAndUpdate(
                    subscriptionId,
                    { $set: updateData },
                    { new: true }
                );
                
                this.logger.info(`Updated subscription ${subscriptionId} notification status: ${notificationSent}`);
                return updatedSubscription;
                
            } catch (error) {
                this.logger.error("Error updating subscription notification status:", error);
                throw error;
            }
        }

        
    },
    
    events: {
        /**
         * Handle workflow completion
         */
        "temporal.workflow.completed": {
            async handler(ctx) {
                const { workflowId, result } = ctx.params;
                
                try {
                    // Find order by workflow ID
                    const order = await this.adapter.findOne({ workflow_id: workflowId });
                    
                    if (order) {
                        await this.adapter.updateById(order._id, {
                            $set: {
                                status: "completed",
                                workflow_status: "completed",
                                message_sent: result.success,
                                completed_at: new Date(),
                                updated_at: new Date()
                            }
                        });
                        
                        this.logger.info(`Order ${order._id} workflow completed successfully`);
                    }
                    
                } catch (error) {
                    this.logger.error("Error handling workflow completion:", error);
                }
            }
        },
        
        /**
         * Handle workflow failure
         */
        "temporal.workflow.failed": {
            async handler(ctx) {
                const { workflowId, error } = ctx.params;
                
                try {
                    // Find order by workflow ID
                    const order = await this.adapter.findOne({ workflow_id: workflowId });
                    
                    if (order) {
                        await this.adapter.updateById(order._id, {
                            $set: {
                                status: "failed",
                                workflow_status: "failed",
                                error_message: error.message,
                                failed_at: new Date(),
                                updated_at: new Date()
                            }
                        });
                        
                        this.logger.error(`Order ${order._id} workflow failed:`, error);
                    }
                    
                } catch (error) {
                    this.logger.error("Error handling workflow failure:", error);
                }
            }
        },

        /**
         * Process catalogue order from WhatsApp
         */
        processCatalogueOrder: {
            params: {
                orderData: "object",
                customerData: "object",
                orgData: "object",
                channelData: "object"
            },
            async handler(ctx) {
                const { orderData, customerData, orgData, channelData } = ctx.params;

                try {
                    this.logger.info(`Processing catalogue order from WhatsApp for customer: ${customerData.phone}`);

                    // Create order record
                    const order = {
                        order_id: orderData.id || `catalogue_${Date.now()}`,
                        customer_id: customerData._id,
                        customer_phone: customerData.phone,
                        customer_name: customerData.name,
                        order_type: "catalogue",
                        source: "whatsapp",
                        channel_id: channelData.channelId,
                        waba_id: channelData.wabaId,
                        status: "pending",
                        workflow_status: "processing",
                        org_id: orgData.orgId,
                        branch_id: orgData.branchId,
                        order_data: orderData,
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    // Save order to database
                    const savedOrder = await this.adapter.insert(order);

                    // Process order items
                    if (orderData.products && Array.isArray(orderData.products)) {
                        for (const product of orderData.products) {
                            await this.processCatalogueOrderItem(savedOrder._id, product, orgData);
                        }
                    }

                    // Send order confirmation
                    await this.sendCatalogueOrderConfirmation(savedOrder, customerData, orgData);

                    // Update order status
                    await this.adapter.updateById(savedOrder._id, {
                        $set: {
                            status: "confirmed",
                            workflow_status: "completed",
                            confirmed_at: new Date(),
                            updated_at: new Date()
                        }
                    });

                    this.logger.info(`Catalogue order processed successfully: ${savedOrder._id}`);

                    return {
                        success: true,
                        orderId: savedOrder._id,
                        orderNumber: order.order_id,
                        status: "confirmed"
                    };

                } catch (error) {
                    this.logger.error("Error processing catalogue order:", error);
                    throw new MoleculerError(
                        `Failed to process catalogue order: ${error.message}`,
                        500,
                        "CATALOGUE_ORDER_ERROR"
                    );
                }
            }
        },

        // /**
        //  * Send WhatsApp message for order confirmation
        //  */
        // sendWhatsAppMessage: {
        //     auth: "required",
        //     rest: {
        //         method: "POST",
        //         path: "/send-whatsapp"
        //     },
        //     params: {
        //         orderData: "object",
        //         customerData: "object",
        //         orgData: "object"
        //     },
        //     async handler(ctx) {
        //         const { orderData, customerData, orgData } = ctx.params;

        //         try {
        //             this.logger.info(`Sending WhatsApp message for order: ${orderData.id}`);
        //             this.logger.info(`Customer phone: ${customerData.phone}`);

        //             // Find available WhatsApp channel
        //             const availableChannel = await this.findAvailableWhatsAppChannel(orgData.orgId);
        //             if (!availableChannel) {
        //                 throw new Error("No WhatsApp channel available");
        //             }

        //             this.logger.info(`Using WhatsApp channel: ${availableChannel._id} (WABA: ${availableChannel.waba_id})`);

        //             // Send WhatsApp message using the template
        //             const whatsappResult = await this.broker.call("whatsapp.SendMsgViaBSP", {
        //                 to: customerData.phone,
        //                 contact_id: customerData._id,
        //                 message_type: "template",
        //                 meta_payload: {
        //                     template_name: "order_confirmation",
        //                     template_data: {
        //                         customer_name: customerData.name || "Customer",
        //                         order_number: orderData.orderNumber || orderData.id,
        //                         total_amount: orderData.totalPrice || "0",
        //                         items: orderData.items ? orderData.items.map(item => item.title).join(", ") : "Items"
        //                     }
        //                 },
        //                 channel_id: availableChannel._id.toString(),
        //                 channel: {
        //                     bsp: "interakt",
        //                     waba_id: availableChannel.waba_id
        //                 }
        //             });

        //             this.logger.info(`WhatsApp message sent successfully: ${whatsappResult.messageId}`);

        //             return {
        //                 success: true,
        //                 messageId: whatsappResult.messageId,
        //                 phone: customerData.phone,
        //                 channel: availableChannel._id.toString()
        //             };

        //         } catch (error) {
        //             this.logger.error("Error sending WhatsApp message:", error);
        //             throw new MoleculerError(`Failed to send WhatsApp message: ${error.message}`, 500, "WHATSAPP_SEND_ERROR");
        //         }
        //     }
        // }
    },
    
    methods: {
        /**
         * Process individual catalogue order item
         */
        async processCatalogueOrderItem(orderId, product, orgData) {
            try {
                // Create order item record
                const orderItem = {
                    order_id: orderId,
                    product_id: product.product_retailer_id,
                    product_name: product.name,
                    quantity: product.quantity || 1,
                    price: product.price || 0,
                    currency: product.currency || "INR",
                    org_id: orgData.orgId,
                    branch_id: orgData.branchId,
                    created_at: new Date()
                };

                // Save order item (you might want to create a separate order items collection)
                this.logger.info(`Processed order item: ${product.name} for order: ${orderId}`);

            } catch (error) {
                this.logger.error("Error processing catalogue order item:", error);
                throw error;
            }
        },

        /**
         * Send catalogue order confirmation
         */
        async sendCatalogueOrderConfirmation(order, customerData, orgData) {
            try {
                // Find available WhatsApp channel
                const availableChannel = await this.findAvailableWhatsAppChannel(orgData.orgId);
                if (!availableChannel) {
                    this.logger.warn("No WhatsApp channel available for order confirmation");
                    return;
                }

                // Send confirmation message
                const confirmationMessage = `Thank you for your order! Your order #${order.order_id} has been confirmed. We'll process it shortly.`;

                const result = await this.broker.call("whatsapp.SendMsgViaBSP", {
                    to: customerData.phone,
                    contact_id: customerData._id,
                    message_type: "text",
                    meta_payload: {
                        body: confirmationMessage
                    },
                    channel_id: availableChannel._id.toString(),
                    channel: {
                        bsp: availableChannel.bsp || "interakt",
                        waba_id: availableChannel.waba_id
                    }
                }, {
                    meta: {
                        org_id: orgData.orgId,
                        branch_id: orgData.branchId
                    }
                });

                this.logger.info(`Order confirmation sent to ${customerData.phone}: ${result.messageId}`);

            } catch (error) {
                this.logger.error("Error sending catalogue order confirmation:", error);
            }
        },

        /**
         * Find available WhatsApp channel
         */
        async findAvailableWhatsAppChannel(orgId) {
            try {
                const channels = await this.broker.call("channel.list", {
                    query: {
                        org_id: orgId,
                        type: "whatsapp",
                        status: "active"
                    }
                });

                if (channels && channels.length > 0) {
                    return channels[0]; // Return first available channel
                }

                return null;
            } catch (error) {
                this.logger.error("Error finding WhatsApp channel:", error);
                return null;
            }
        }
    },

    created() {
        this.logger.info("Order Processor service created");
    },
    
    started() {
        this.logger.info("Order Processor service started");
    },
    
    stopped() {
        this.logger.info("Order Processor service stopped");
    }
};
