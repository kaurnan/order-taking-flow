const { Worker } = require("@temporalio/worker");
const { OrderConfirmationWorkflow } = require("./services/temporal/order-confirmation.workflow");
const { OrderConfirmationActivities } = require("./services/temporal/order-confirmation.activities");

async function startWorker() {
    console.log("Starting Temporal Worker...");
    
    try {
        // Create the worker with minimal configuration
        const worker = await Worker.create({
            workflowsPath: require.resolve("./services/temporal/order-confirmation.workflow"),
            activities: OrderConfirmationActivities,
            taskQueue: "order-confirmation-queue",
            namespace: "default"
        });
        
        console.log("Temporal Worker created successfully");
        console.log("Task Queue: order-confirmation-queue");
        console.log("Namespace: default");
        console.log("Address: localhost:7233");
        console.log("Worker is running...");
        
        // Start the worker
        await worker.run();
        
    } catch (error) {
        console.error("Error starting Temporal Worker:", error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log("Shutting down Temporal Worker...");
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log("Shutting down Temporal Worker...");
    process.exit(0);
});

// Start the worker
startWorker().catch(console.error);


