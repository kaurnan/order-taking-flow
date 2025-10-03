const { Queue } = require('bullmq');
const Redis = require("ioredis");
const dotenv = require("dotenv");
dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});

const broadcastBatchQueue = new Queue('broadcast-batch-queue', { connection });

module.exports = broadcastBatchQueue;
