"use strict";

const { Worker } = require("@temporalio/worker");
const { OrderConfirmationWorkflow } = require("./order-confirmation.workflow");
const { OrderConfirmationActivities } = require("./order-confirmation.activities");

module.exports = {
    name: "temporal-worker",
    
    settings: {
        temporalAddress: process.env.TEMPORAL_ADDRESS || "localhost:7233",
        namespace: process.env.TEMPORAL_NAMESPACE || "default",
        taskQueue: "order-confirmation-queue"
    },
    
    async started() {
        this.logger.info("Starting Temporal Worker...");
        
        try {
            // Check if Temporal server is available before creating worker
            const { Connection } = require("@temporalio/client");
            const connection = await Connection.connect({
                address: this.settings.temporalAddress
            });
            
            this.logger.info(`Connected to Temporal server at ${this.settings.temporalAddress}`);
            
            // Create the worker
            this.worker = await Worker.create({
                workflowsPath: require.resolve("./order-confirmation.workflow"),
                activities: OrderConfirmationActivities,
                taskQueue: this.settings.taskQueue,
                namespace: this.settings.namespace,
                connection: connection
            });

            // Attach error event listeners for the worker if supported
            if (typeof this.worker.on === "function") {
                this.worker.on("error", (err) => {
                    this.logger.error("Temporal Worker encountered an error event:", err);
                });
                this.worker.on("shutdown", () => {
                    this.logger.info("Temporal Worker shutdown event received.");
                });
            }
            
            this.logger.info(`Temporal Worker started successfully`);
            this.logger.info(`Task Queue: ${this.settings.taskQueue}`);
            this.logger.info(`Namespace: ${this.settings.namespace}`);
            this.logger.info(`Address: ${this.settings.temporalAddress}`);
            
            // Start the worker and handle uncaught errors
            try {
                await this.worker.run();
            } catch (runError) {
                this.logger.error("Temporal Worker stopped due to run error:", runError);
                // Optionally, you could process.exit(1) here if you want to crash the service
                throw runError;
            }
            
        } catch (error) {
            this.logger.error("Error starting Temporal Worker:", error);
            this.logger.warn("Temporal Worker will be disabled. Make sure Temporal server is running.");
            this.logger.warn("To start Temporal server, run: temporal server start-dev");
            // Don't throw the error to prevent the entire service from failing
            this.worker = null;
        }
    },
    
    async stopped() {
        if (this.worker) {
            this.logger.info("Stopping Temporal Worker...");
            try {
                await this.worker.shutdown();
                this.logger.info("Temporal Worker stopped");
            } catch (shutdownError) {
                this.logger.error("Error shutting down Temporal Worker:", shutdownError);
                throw shutdownError;
            }
        } else {
            this.logger.warn("Temporal Worker is not running or already stopped.");
        }
    }
};
