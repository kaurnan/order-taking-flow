"use strict";

const { MoleculerError } = require("moleculer").Errors;

module.exports = {
    name: "order-processor-simple-disabled",
    
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
                orgId: { type: "any" },
                branchId: { type: "any" }
            },
            async handler(ctx) {
                const { orderData, customerData, orgId, branchId } = ctx.params;
                
                try {
                    this.logger.info(`Processing new order: ${orderData.id} for org: ${orgId}`);
                    
                    // Simulate order processing
                    const result = {
                        success: true,
                        message: "Order processed successfully",
                        data: {
                            orderId: `order_${Date.now()}`,
                            workflowId: `workflow_${Date.now()}`,
                            customerId: `customer_${Date.now()}`
                        }
                    };
                    
                    this.logger.info(`Order ${orderData.id} processed successfully:`, result);
                    
                    return result;
                    
                } catch (error) {
                    this.logger.error("Error processing order:", error);
                    throw new MoleculerError("Failed to process order", 500, "ORDER_PROCESSING_ERROR");
                }
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
