const { Worker } = require("bullmq");
const profileExportJob = require("../jobs/profile_export");
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
    nodeID: `profile-export-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: profile-export-worker', process.env.TRANSPORTER);

// Use absolute paths to ensure services load correctly
const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/utility/notification.service.js"));

(async () => {
    await broker.start();

    const worker = new Worker("profile-export", profileExportJob, {
        connection,
        autorun: true,
        concurrency: 1, // Process only 1 profile export at a time (resource intensive)
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
        console.log(`🎉 Profile export job ${job.id} has completed successfully!`);
        console.log(`Export ID: ${result.exportId}, Status: ${result.status}, Records: ${result.recordCount}`);

        // Send notification to user about completion if needed
        if (result.status === "completed" && job.data.branchId) {
            try {
                broker.call('notification.send', {
                    templateKey: 'profile_export_completed',
                    variables: {
                        exportTitle: job.data.title,
                        recordCount: result.recordCount,
                        fileUrl: result.fileUrl,
                        exportType: job.data.exportType
                    },
                    additionalData: {
                        organisation_id: job.data.orgId,
                        branch_id: job.data.branchId,
                        user_id: job.data.userId
                    }
                }).catch(notificationError => {
                    console.warn(`Failed to send notification for profile export completion: ${notificationError.message}`);
                });
            } catch (notificationError) {
                console.warn(`Failed to send notification for profile export completion: ${notificationError.message}`);
            }
        }
    });

    worker.on("failed", (job, err) => {
        console.log(`❌ Profile export job ${job.id} has failed with ${err.message}`);

        // Send error notification if user_id is available
        if (job.data.userId) {
            try {
                broker.call('notification.send', {
                    templateKey: 'profile_export_failed',
                    variables: {
                        error: err.message,
                        exportTitle: job.data.title
                    },
                    additionalData: {
                        organisation_id: job.data.orgId,
                        branch_id: job.data.branchId,
                        user_id: job.data.userId
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
        console.log(`📊 Profile export job ${job.id} progress: ${progress}%`);
    });

    // Add close method for external access
    worker.closeWorker = async () => {
        console.log('🛑 Closing profile export worker...');
        await worker.close();
        await broker.stop();
    };

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down profile export worker gracefully...');
        await worker.closeWorker();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down profile export worker gracefully...');
        await worker.closeWorker();
        process.exit(0);
    });
})();
