const { Worker } = require("@temporalio/worker");
const { CatalogueMessagingWorkflow } = require("./services/temporal/catalogue-messaging.workflow");
const { sendCatalogueMessage, sendCatalogueTemplate } = require("./services/temporal/catalogue-messaging.activities");

async function startCatalogueWorker() {
    console.log("Starting Temporal Catalogue Messaging Worker...");
    
    try {
        // Create the worker for catalogue messaging
        const worker = await Worker.create({
            workflowsPath: require.resolve("./services/temporal/catalogue-messaging.workflow"),
            activities: {
                sendCatalogueMessage,
                sendCatalogueTemplate
            },
            taskQueue: "catalogue-messaging-queue",
            namespace: "default"
        });
        
        console.log("Temporal Catalogue Worker created successfully");
        console.log("Task Queue: catalogue-messaging-queue");
        console.log("Namespace: default");
        console.log("Address: localhost:7233");
        console.log("Worker is running...");
        
        // Start the worker
        await worker.run();
        
    } catch (error) {
        console.error("Error starting Temporal Catalogue Worker:", error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log("Shutting down Temporal Catalogue Worker...");
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log("Shutting down Temporal Catalogue Worker...");
    process.exit(0);
});

// Start the worker
startCatalogueWorker().catch(console.error);
