"use strict";

const { MoleculerError } = require("moleculer").Errors;

module.exports = {
    name: "order-processor-test-disabled",
    
    actions: {
        /**
         * Test action
         */
        test: {
            rest: {
                method: "GET",
                path: "/test"
            },
            async handler(ctx) {
                return {
                    success: true,
                    message: "Order processor test service is working!",
                    timestamp: new Date().toISOString()
                };
            }
        }
    },
    
    created() {
        this.logger.info("Order Processor Test service created");
    },
    
    started() {
        this.logger.info("Order Processor Test service started");
    },
    
    stopped() {
        this.logger.info("Order Processor Test service stopped");
    }
};
