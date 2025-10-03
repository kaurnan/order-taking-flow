const { Worker } = require('bullmq');
const Redis = require('ioredis');
const dotenv = require('dotenv');
const { connectMongo } = require("../../mixins/db");
const { ObjectId } = require("mongodb");
const { ServiceBroker } = require('moleculer');
const axios = require('axios');
const path = require('path');

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

const broker = new ServiceBroker({
    logger: console,
    nodeID: `template-delete-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: template-delete-worker', process.env.TRANSPORTER);

// Use absolute paths to ensure services load correctly
const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/communication/whatsapp.service.js"));

(async () => {
    await broker.start();

    const worker = new Worker('template-delete-queue', async job => {
        const data = job.data;
        console.log(`Processing template deletion job: ${job.id}`, JSON.stringify(data));

        try {
            const db = await connectMongo();
            const templateCollection = db.collection('whatsapptemplates');

            const { templateId, org_id, jobId } = data;

            // Fetch the template
            const template = await templateCollection.findOne({
                _id: new ObjectId(templateId),
                org_id: new ObjectId(org_id)
            });

            if (!template) {
                throw new Error(`Template ${templateId} not found or access denied`);
            }

            console.log(`Processing template for deletion: ${template._id}`);

            // Delete from Meta API for each WABA
            if (Array.isArray(template.meta_templates)) {
                for (const meta of template.meta_templates) {
                    console.log(`Deleting meta template: ${meta.id} from waba: ${meta.waba_id}`);
                    try {
                        await axios.delete(
                            `https://graph.facebook.com/v20.0/${meta.waba_id}/message_templates?hsm_id=${meta.id}&name=${meta.name}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`
                                },
                                timeout: 30000 // 30 second timeout for each API call
                            }
                        );
                        console.log(`Successfully deleted meta template: ${meta.id}`);
                    } catch (err) {
                        // Log error but continue with other templates
                        console.error(`Failed to delete template from Meta for waba_id ${meta.waba_id}:`, err.response?.data || err.message);
                        // Don't throw here to allow other meta templates to be processed
                    }
                }
            }

            // Delete the template from the collection
            await templateCollection.deleteOne({ _id: new ObjectId(templateId) });

            console.log(`Successfully deleted template: ${template._id}`);

            // Update job progress
            await broker.call("whatsapp.updateBulkDeleteProgress", {
                jobId,
                templateId,
                status: "success",
                message: "Template deleted successfully"
            });

            return {
                success: true,
                templateId: template._id.toString(),
                name: template.name,
                message: "Template deleted successfully"
            };

        } catch (error) {
            console.error(`Error deleting template in job ${job.id}:`, error.message);

            // Update job progress with error
            try {
                await broker.call("whatsapp.updateBulkDeleteProgress", {
                    jobId: data.jobId,
                    templateId: data.templateId,
                    status: "failed",
                    error: error.message
                });
            } catch (updateError) {
                console.error("Failed to update progress:", updateError);
            }

            throw error;
        }
    }, {
        connection,
        concurrency: 5, // Process 5 templates concurrently
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
    });

    worker.on('completed', job => {
        console.log(`Template deletion job ${job.id} completed successfully`);
    });

    worker.on('failed', async (job, err) => {
        console.error(`Template deletion job ${job.id} failed:`, err.message);

        // If this was the last attempt, mark the job as permanently failed
        if (job.attemptsMade >= (job.opts.attempts || 3)) {
            try {
                await broker.call("whatsapp.updateBulkDeleteProgress", {
                    jobId: job.data.jobId,
                    templateId: job.data.templateId,
                    status: "permanently_failed",
                    error: `Failed after ${job.attemptsMade} attempts: ${err.message}`
                });
            } catch (updateError) {
                console.error("Failed to update final progress:", updateError);
            }
        }
    });

    worker.on('error', err => {
        console.error('Worker error:', err);
    });

    console.log('Template deletion worker started');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down template delete worker gracefully...');
        await worker.close();
        await broker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down template delete worker gracefully...');
        await worker.close();
        await broker.stop();
        process.exit(0);
    });
})();
