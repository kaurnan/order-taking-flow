const { Worker } = require("bullmq");
const customerExportJob = require("../jobs/customer_export");
const Redis = require("ioredis");
const dotenv = require('dotenv');
const { ServiceBroker } = require("moleculer");
const path = require('path');

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

// Create a service broker instance
const broker = new ServiceBroker({
    logger: console,
    nodeID: `customer-export-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: customer-export-worker', process.env.TRANSPORTER);

// Use absolute paths to ensure services load correctly
const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/utility/notification.service.js"));

(async () => {
    await broker.start();

    const worker = new Worker("customer-export", customerExportJob, {
        connection,
        autorun: true,
        concurrency: 1, // Process only 1 export at a time (resource intensive)
    });

    // Add waitUntilReady method for the start-queues script
    worker.waitUntilReady = async () => {
        return new Promise((resolve) => {
            if (worker.isRunning()) {
                resolve();
            } else {
                worker.once('ready', resolve);
            }
        });
    };

    worker.on("completed", (job, result) => {
        console.log(`🎉 Customer export job ${job.id} has completed successfully!`);
        console.log(`Status: ${result.status}, Records: ${result.customer_count}, File: ${result.fileurl}`);

        // Send notification to user about completion if needed
        if (result.status === "Completed" && job.data.branch_id) {
            try {
                broker.call('notification.send', {
                    templateKey: 'customer_export_success',
                    variables: {
                        userImage: job.data.user_image ?? "",
                        fileUrl: result.fileurl
                    },
                    additionalData: {
                        branch_id: job.data.branch_id,
                        organisation_id: job.data.org_id,
                        user_id: job.data.user_id
                    }
                }).catch(notificationError => {
                    console.warn(`Failed to send notification for customer export completion: ${notificationError.message}`);
                });
            } catch (notificationError) {
                console.warn(`Failed to send notification for customer export completion: ${notificationError.message}`);
            }
        }
    });

    worker.on("failed", (job, err) => {
        console.log(`❌ Customer export job ${job.id} has failed with ${err.message}`);

        // Send error notification if user_id is available
        if (job.data.user_id) {
            try {
                broker.call('notification.send', {
                    templateKey: 'customer_export_failed',
                    variables: {
                        error: err.message
                    },
                    additionalData: {
                        organisation_id: job.data.org_id,
                        branch_id: job.data.branch_id,
                        user_id: job.data.user_id
                    }
                }).catch(notificationError => {
                    console.warn(`Failed to send error notification: ${notificationError.message}`);
                });
            } catch (notificationError) {
                console.warn(`Failed to send error notification: ${notificationError.message}`);
            }
        }
    });

    worker.on("progress", (job, progress) => {
        console.log(`📊 Customer export job ${job.id} progress: ${progress}%`);
    });

    // Add close method for external access
    worker.closeWorker = async () => {
        console.log('🛑 Closing customer export worker...');
        await worker.close();
        await broker.stop();
    };

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down customer export worker gracefully...');
        await worker.closeWorker();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down customer export worker gracefully...');
        await worker.closeWorker();
        process.exit(0);
    });
})();
