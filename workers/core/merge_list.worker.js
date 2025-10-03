const { Worker } = require("bullmq");
const mergeListJob = require("../jobs/merge_list");
const Redis = require("ioredis");
const dotenv = require('dotenv');
const { ServiceBroker } = require("moleculer");
const path = require('path');

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

// Create a service broker instance like send_message.worker.js
const broker = new ServiceBroker({
    logger: console,
    nodeID: `merge-list-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: merge-list-worker', process.env.TRANSPORTER);

// Use absolute paths to ensure services load correctly
const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/utility/notification.service.js"));
broker.loadService(path.join(projectRoot, "../services/integration/supabase.service.js"));

(async () => {
    await broker.start();

    const worker = new Worker("merge-list", mergeListJob, {
        connection,
        autorun: true,
        concurrency: 2, // Process up to 2 jobs simultaneously
    });

    worker.on("completed", (job, result) => {
        console.log(`🎉 Job ${job.id} has completed successfully!`);
        console.log(result, job.data);
        // Send notification to user about completion
        if (result.success && job.data.branch_id) {
            try {
                console.log(result, job.data);
                // Use the broker instance we created
                broker.call('notification.send', {
                    templateKey: 'merge_list_completed',
                    variables: {
                        mergedCount: result.data.mergedCount,
                        destinationList: result.data.destinationList,
                    },
                    additionalData: {
                        organisation_id: job.data.org_id,
                        branch_id: job.data.branch_id
                    }
                }).catch(notificationError => {
                    console.warn(`Failed to send notification for merge list completion: ${notificationError.message}`);
                });
            } catch (notificationError) {
                console.warn(`Failed to send notification for merge list completion: ${notificationError.message}`);
            }
        }
    });

    worker.on("failed", (job, err) => {
        console.log(`❌ Job ${job.id} has failed with ${err.message}`);

        // Send error notification if user_id is available
        if (job.data.user_id) {
            try {
                // Use the broker instance we created
                broker.call('notification.sendNotification', {
                    templateKey: 'merge_list_failed',
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
        console.log(`📊 Job ${job.id} progress: ${progress}%`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down merge list worker gracefully...');
        await worker.close();
        await broker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down merge list worker gracefully...');
        await worker.close();
        await broker.stop();
        process.exit(0);
    });
})();
