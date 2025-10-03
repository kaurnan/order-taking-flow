const { Worker } = require("@temporalio/worker");
const { OrderCancellationWorkflow } = require("./services/temporal/order-cancellation.workflow");
const { OrderCancellationActivities } = require("./services/temporal/order-cancellation.activities");

async function startCancellationWorker() {
    console.log("Starting Temporal Cancellation Worker...");
    
    try {
        // Create the worker for cancellation workflows
        const worker = await Worker.create({
            workflowsPath: require.resolve("./services/temporal/order-cancellation.workflow"),
            activities: OrderCancellationActivities,
            taskQueue: "order-cancellation-queue",
            namespace: "default"
        });
        
        console.log("Temporal Cancellation Worker created successfully");
        console.log("Task Queue: order-cancellation-queue");
        console.log("Namespace: default");
        console.log("Address: localhost:7233");
        console.log("Worker is running...");
        
        // Start the worker
        await worker.run();
        
    } catch (error) {
        console.error("Error starting Temporal Cancellation Worker:", error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log("Shutting down Temporal Cancellation Worker...");
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log("Shutting down Temporal Cancellation Worker...");
    process.exit(0);
});

// Start the worker
startCancellationWorker().catch(console.error);
