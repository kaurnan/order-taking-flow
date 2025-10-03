const { Queue } = require("bullmq");
const dotenv = require("dotenv");
const Redis = require("ioredis");

dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});


const invoiceQueue = new Queue("invoiceQueue", {
    connection,
    defaultJobOptions: {
        attempts: 2,
        removeOnComplete: {
            age: 3600,
        },
        removeOnFail: {
            age: 24 * 3600,
        },
    },
});

module.exports = invoiceQueue;
