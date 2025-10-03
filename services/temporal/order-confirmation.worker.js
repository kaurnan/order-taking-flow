"use strict";

const { Worker } = require("@temporalio/worker");
const { OrderConfirmationWorkflow } = require("./order-confirmation.workflow");
const { OrderConfirmationActivities } = require("./order-confirmation.activities");

/**
 * Order Confirmation Temporal Worker
 * 
 * This worker processes order confirmation workflows
 */
class OrderConfirmationWorker {
    
    constructor() {
        this.worker = null;
        this.isRunning = false;
    }
    
    /**
     * Start the Temporal worker
     */
    async start() {
        try {
            this.worker = await Worker.create({
                workflowsPath: require.resolve("./order-confirmation.workflow"),
                activities: OrderConfirmationActivities,
                taskQueue: "order-confirmation-queue",
                namespace: "flowflex",
                // Add connection configuration
                connection: {
                    address: process.env.TEMPORAL_SERVER_URL || "localhost:7233"
                }
            });

            this.isRunning = true;
            console.log("Order Confirmation Worker started successfully");

            // Attach error event listeners for the worker
            this.worker.on?.("error", (err) => {
                console.error("Worker encountered an error event:", err);
            });

            // Run the worker and handle uncaught errors
            await this.worker.run().catch((runError) => {
                this.isRunning = false;
                console.error("Order Confirmation Worker stopped due to run error:", runError);
                // Optionally, process.exit(1);
            });

        } catch (error) {
            this.isRunning = false;
            console.error("Error starting Order Confirmation Worker:", error);
            // Optionally, process.exit(1);
            throw error;
        }
    }
    
    /**
     * Stop the Temporal worker
     */
    async stop() {
        if (this.worker) {
            try {
                await this.worker.shutdown();
                this.isRunning = false;
                console.log("Order Confirmation Worker stopped");
            } catch (shutdownError) {
                console.error("Error shutting down Order Confirmation Worker:", shutdownError);
                throw shutdownError;
            }
        } else {
            console.warn("Order Confirmation Worker is not running or already stopped.");
        }
    }
}

module.exports = OrderConfirmationWorker;
