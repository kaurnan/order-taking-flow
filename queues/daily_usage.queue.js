const { Queue } = require("bullmq");
const Redis = require("ioredis");
const dotenv = require("dotenv");

dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});

const dailyUsageQueue = new Queue("dailyUsageQueue", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000
        },
        removeOnComplete: {
            age: 3600, // Keep completed jobs for 1 hour
        },
        removeOnFail: {
            age: 24 * 3600, // Keep failed jobs for 24 hours
        },
        timeout: 300000 // 5 minutes timeout
    },
});

module.exports = dailyUsageQueue;
