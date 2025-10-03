const { Worker } = require('bullmq');
const Redis = require('ioredis');
const dotenv = require('dotenv');
const { ServiceBroker } = require("moleculer");
const path = require('path');

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

const broker = new ServiceBroker({
    logger: console,
    nodeID: `send-message-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: send-message-worker', process.env.TRANSPORTER);

// Use absolute paths to ensure services load correctly
const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/communication/whatsapp.service.js"));
broker.loadService(path.join(projectRoot, "../services/integration/supabase.service.js"));
broker.loadService(path.join(projectRoot, "../services/customer/customer.service.js"));
broker.loadService(path.join(projectRoot, "../services/utility/agent.service.js"));
broker.loadService(path.join(projectRoot, "../services/ums/ums_user_organisations.service.js"));

let workerInstance = null;
let brokerInstance = null;

(async () => {
    await broker.start();
    brokerInstance = broker;

    const worker = new Worker('send-broadcast-message', async job => {
        const { phone, broadcastId, template, org_id, channel, customer_id, name } = job.data;
        console.log(`Sending message to ${phone}`);

        try {
            // Emit the send.message event to the WhatsApp service
            await broker.emit("send.message", {
                org_id,
                phone,
                channel,
                customer_id,
                name,
                template,
                broadcastId
            });

            return 'message sent initiated';
        } catch (err) {
            console.error("Action error:", err);
            return err;
        }
    }, {
        connection,
        concurrency: 50,
    });

    workerInstance = worker;

    worker.on('completed', job => console.log(`Job ${job.id} completed`));
    worker.on('failed', async (job, err) => {
        console.error(`Job ${job.id} failed:`, err);
        // Check if this was the last attempt
        if (job.attemptsMade >= (job.opts.attempts || 1)) {
            // Mark the broadcast as failed in your database
            const { broadcastId } = job.data;
            if (broadcastId) {
                try {
                    await broker.call("supabase.updateData", {
                        table: "broadcasts_moleculer",
                        criteria: { id: broadcastId },
                        payload: { status: "failed", error_message: err.message || "Unknown error" }
                    });
                    console.log(`Broadcast ${broadcastId} marked as failed.`);
                } catch (updateErr) {
                    console.error("Failed to update broadcast status:", updateErr);
                }
            }
        }
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down send message worker gracefully...');
        await worker.close();
        await broker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down send message worker gracefully...');
        await worker.close();
        await broker.stop();
        process.exit(0);
    });
})();

module.exports = {
    close: async () => {
        try {
            if (workerInstance) {
                await workerInstance.close();
            }
            if (brokerInstance) {
                await brokerInstance.stop();
            }
        } catch (e) {
            console.log("Error closing send message worker:", e.message);
        }
    }
};
