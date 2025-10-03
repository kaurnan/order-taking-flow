const { Worker } = require("bullmq");
const bulkCustomerUpdateJob = require("../jobs/bulk_customer_update");
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
    nodeID: `bulk-customer-update-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: bulk-customer-update-worker', process.env.TRANSPORTER);

// Use absolute paths to ensure services load correctly
const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/utility/notification.service.js"));

(async () => {
    await broker.start();

    const worker = new Worker("bulk-customer-update", bulkCustomerUpdateJob, {
        connection,
        autorun: true,
        concurrency: 2, // Process up to 2 jobs simultaneously
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
        console.log(`🎉 Bulk customer update job ${job.id} has completed successfully!`);
        console.log(`Modified count: ${result.modifiedCount}, Action: ${result.action}`);

        // Send notification to user about completion if needed
        if (result.success && job.data.branch_id) {
            try {
                broker.call('notification.send', {
                    templateKey: 'bulk_action_success',
                    variables: {
                        actionTitle: `Bulk ${result.action} completed`,
                        successMessage: `Successfully updated ${result.modifiedCount} customers`,
                        userImage: job.data.user_image,
                        fileUrl: result.fileurl
                    },
                    additionalData: {
                        organisation_id: job.data.org_id,
                        branch_id: job.data.branch_id,
                        user_id: job.data.user_id
                    }
                }).catch(notificationError => {
                    console.warn(`Failed to send notification for bulk customer update completion: ${notificationError.message}`);
                });
            } catch (notificationError) {
                console.warn(`Failed to send notification for bulk customer update completion: ${notificationError.message}`);
            }
        }
    });

    worker.on("failed", (job, err) => {
        console.log(`❌ Bulk customer update job ${job.id} has failed with ${err.message}`);

        // Send error notification if user_id is available
        if (job.data.user_id) {
            try {
                broker.call('notification.send', {
                    templateKey: 'bulk_action_failed',
                    variables: {
                        error: err.message,
                        action: job.data.action
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
        console.log(`📊 Bulk customer update job ${job.id} progress: ${progress}%`);
    });

    // Add close method for external access
    worker.closeWorker = async () => {
        console.log('🛑 Closing bulk customer update worker...');
        await worker.close();
        await broker.stop();
    };

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down bulk customer update worker gracefully...');
        await worker.closeWorker();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down bulk customer update worker gracefully...');
        await worker.closeWorker();
        process.exit(0);
    });
})();
