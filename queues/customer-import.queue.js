const { Queue } = require("bullmq");
const Redis = require("ioredis");
const dotenv = require("dotenv");

dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});

const customerImportQueue = new Queue("customer-import", {
    connection,
    defaultJobOptions: {
        attempts: 2,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
        removeOnComplete: {
            age: 3600,
        },
        removeOnFail: {
            age: 24 * 3600,
        },
        timeout: 300000,
    },
});

module.exports = customerImportQueue;


