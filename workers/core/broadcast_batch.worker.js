const { Worker, tryCatch } = require('bullmq');
const Redis = require('ioredis');
const dotenv = require('dotenv');
const { connectMongo } = require("../../mixins/db");
const { ObjectId } = require("mongodb");
const sendMessageQueue = require('../../queues/send_message.queue');
const { ServiceBroker } = require('moleculer');
const { MoleculerError } = require('moleculer').Errors;
const path = require('path');
const { formatQuery } = require('../../utils/common');

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

const broker = new ServiceBroker({
    logger: console,
    nodeID: `broadcast-batch-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: broadcast-batch-worker', process.env.TRANSPORTER);

// Use absolute paths to ensure services load correctly
const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/broadcast/broadcast.service.js"));
broker.loadService(path.join(projectRoot, "../services/customer/customer.service.js"));

(async () => {
    await broker.start();
    const worker = new Worker('broadcast-batch-queue', async job => {
        const data = job.data;
        console.log(`Processing batch ${data.batchNumber}/${data.totalBatches} for broadcast ${data.broadcastId}`);
        console.log(`Batch details:`, JSON.stringify({
            startId: data.startId,
            endId: data.endId,
            limit: data.limit,
            batchNumber: data.batchNumber
        }));

        try {

            const db = await connectMongo();
            let query = {
                org_id: new ObjectId(data.org_id),
                branch_id: new ObjectId(data.branch_id),
            }
            console.log(`Base query for customers:`, JSON.stringify(query));

            switch (data.audience_category) {
                case "list":
                    query = {
                        ...query,
                        lists: { $in: data?.audience_ref.map(id => new ObjectId(id)) }
                    };
                    break;
                case "segment":
                    const segmentConditions = [];

                    for (const segId of data?.audience_ref) {
                        const segmentCollection = db.collection('segments');
                        const segment = await segmentCollection.findOne({ _id: new ObjectId(segId) });
                        console.log('Segment found:', segment);
                        if (!segment) throw new MoleculerError(`Segment not found: ${segId}`, 404, "NOT_FOUND");

                        // Parse and flatten nested $AND operators
                        const segmentRules = JSON.parse(segment?.rules);
                        console.log('Original segment rules:', JSON.stringify(segmentRules, null, 2));
                        const formattedRules = formatQuery(segmentRules);
                        console.log('Formatted rules:', JSON.stringify(formattedRules, (key, value) => {
                            if (value instanceof RegExp) {
                                return value.toString();
                            }
                            return value;
                        }, 2));

                        let segmentCondition = {};

                        // Flatten nested $and operators if they exist
                        if (formattedRules.$and) {
                            const flattenedConditions = [];

                            function flattenAnd(conditions) {
                                for (const condition of conditions) {
                                    if (condition.$and) {
                                        flattenAnd(condition.$and);
                                    } else {
                                        flattenedConditions.push(condition);
                                    }
                                }
                            }

                            flattenAnd(formattedRules.$and);

                            // Merge all conditions into the segment condition
                            for (const condition of flattenedConditions) {
                                Object.assign(segmentCondition, condition);
                            }
                        } else {
                            Object.assign(segmentCondition, formattedRules);
                        }

                        segmentConditions.push(segmentCondition);
                    }

                    // Combine all segment conditions with $or
                    if (segmentConditions.length === 1) {
                        Object.assign(query, segmentConditions[0]);
                    } else if (segmentConditions.length > 1) {
                        query.$or = segmentConditions;
                    }
                    break;
                case "manual":
                    query = {
                        ...query,
                        _id: { $in: data.audience_ref.map(id => new ObjectId(id)) }
                    };
                default:
                    break;
            }

            console.log(`Final query for customers:`, JSON.stringify(query, (key, value) => {
                if (value instanceof RegExp) {
                    return value.toString();
                }
                return value;
            }, 2));

            const collection = db.collection('customers');

            // Check if we need internal batching (limit > 1000)
            const originalLimit = parseInt(data.limit);
            const CHUNK_SIZE = 1000;
            const needsInternalBatching = originalLimit > CHUNK_SIZE;

            if (needsInternalBatching) {
                console.log(`Batch ${data.batchNumber}: Large batch detected (${originalLimit} customers). Processing in chunks of ${CHUNK_SIZE}`);

                let totalProcessed = 0;
                let currentOffset = data.startId;

                while (totalProcessed < originalLimit) {
                    const remainingCustomers = originalLimit - totalProcessed;
                    const currentChunkSize = Math.min(CHUNK_SIZE, remainingCustomers);

                    console.log(`Batch ${data.batchNumber}: Processing chunk at offset ${currentOffset}, size ${currentChunkSize} (${totalProcessed + 1} to ${totalProcessed + currentChunkSize} of ${originalLimit})`);

                    // Fetch customers for this chunk
                    const customers = await collection.find(query)
                        .skip(currentOffset)
                        .limit(currentChunkSize)
                        .toArray();

                    if (customers.length === 0) {
                        console.log(`Batch ${data.batchNumber}: No more customers found at offset ${currentOffset}, stopping internal batching`);
                        break;
                    }

                    await broker.call("whatsapp.getTemplateById", {
                        id: data?.template.template_id,
                    });

                    // Prepare bulk jobs array for this chunk with rate limiting
                    const bulkJobs = customers.map((customer, index) => {
                        // Calculate delay: 200ms per message to achieve 5 messages/second
                        const delayMs = index * 200;

                        return {
                            name: 'send',
                            data: {
                                phone: customer.phone,
                                org_id: data.org_id,
                                branch_id: data.branch_id,
                                customer_id: customer._id,
                                name: customer.name,
                                template: data.template,
                                broadcastId: data.broadcastId,
                                title: data.title,
                                audience_category: data.audience_category,
                                audience_ref: data.audience_ref,
                                channel: data.channel,
                                batchNumber: data.batchNumber,
                                totalBatches: data.totalBatches,
                                chunkOffset: currentOffset,
                                chunkSize: currentChunkSize,
                                totalProcessed: totalProcessed + customers.length
                            },
                            opts:
                            {
                                delay: delayMs, // Add progressive delay
                                attempts: 2,
                                backoff:
                                {
                                    type: 'fixed',
                                    delay: 60000 // 1 minute (60 seconds)
                                }
                            }
                        };
                    });

                    // Add all jobs in bulk for this chunk
                    await sendMessageQueue.addBulk(bulkJobs);
                    console.log(`Batch ${data.batchNumber}: Added ${bulkJobs.length} jobs to send message queue for chunk at offset ${currentOffset}`);

                    // Update counters for next iteration
                    totalProcessed += customers.length;
                    currentOffset += customers.length;

                    // Add a small delay between chunks to avoid overwhelming the queue
                    if (totalProcessed < originalLimit) {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                    }
                }

                console.log(`Batch ${data.batchNumber}: Completed internal batching. Total customers processed: ${totalProcessed}`);

            } else {
                // Normal processing for batches <= 1000
                const customers = await collection.find(query)
                    .skip(data.startId)
                    .limit(data.limit)
                    .toArray();

                console.log(`Batch ${data.batchNumber}: Found ${customers.length} customers (${data.startId} to ${data.startId + customers.length})`);

                if (customers.length === 0) {
                    console.log(`No customers found for batch ${data.batchNumber}, skipping...`);
                    return;
                }

                await broker.call("whatsapp.getTemplateById", {
                    id: data?.template.template_id,
                });

                // Prepare bulk jobs array for this batch with rate limiting
                const bulkJobs = customers.map((customer, index) => {
                    // Calculate delay: 200ms per message to achieve 5 messages/second
                    const delayMs = index * 200;

                    return {
                        name: 'send',
                        data: {
                            phone: customer.phone,
                            org_id: data.org_id,
                            branch_id: data.branch_id,
                            customer_id: customer._id,
                            name: customer.name,
                            template: data.template,
                            broadcastId: data.broadcastId,
                            title: data.title,
                            audience_category: data.audience_category,
                            audience_ref: data.audience_ref,
                            channel: data.channel,
                            batchNumber: data.batchNumber,
                            totalBatches: data.totalBatches
                        },
                        opts: {
                            delay: delayMs, // Add progressive delay
                            attempts: 2,
                            backoff: {
                                type: 'fixed',
                                delay: 60000 // 1 minute (60 seconds)
                            }
                        }
                    };
                });

                // Add all jobs in bulk for this batch
                await sendMessageQueue.addBulk(bulkJobs);
                console.log(`Batch ${data.batchNumber}: Added ${bulkJobs.length} jobs to send message queue`);
            }

            // Update batch status to completed in the broadcast document
            try {
                await broker.call("broadcast.updateBatchStatus", {
                    broadcastId: data.broadcastId,
                    batchNumber: data.batchNumber,
                    status: "completed",
                    completedAt: new Date(),
                    processedCustomers: data.totalProcessed || data.limit // Use totalProcessed if available, otherwise limit
                });
                console.log(`Batch ${data.batchNumber}: Status updated to completed`);
            } catch (updateError) {
                console.error(`Failed to update batch ${data.batchNumber} status:`, updateError);
                // Don't throw here as the main batch processing was successful
            }

        } catch (error) {
            console.error(`Error processing batch ${data.batchNumber}:`, error);

            // Update batch status to failed in the broadcast document
            try {
                await broker.call("broadcast.updateBatchStatus", {
                    broadcastId: data.broadcastId,
                    batchNumber: data.batchNumber,
                    status: "failed",
                    failedAt: new Date(),
                    error: error.message || error.toString()
                });
                console.log(`Batch ${data.batchNumber}: Status updated to failed`);
            } catch (updateError) {
                console.error(`Failed to update batch ${data.batchNumber} status to failed:`, updateError);
            }

            throw error;
        }
    }, {
        connection,
        concurrency: 10,
    });

    worker.on('completed', job => console.log(`Job ${job.id} completed`));
    worker.on('failed', async (job, err) => {
        console.error(`Job ${job.id} failed:`, err);
    });

    console.log('Broadcast batch worker started');
})();
