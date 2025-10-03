const { Queue } = require("bullmq");
const Redis = require("ioredis");
const dotenv = require("dotenv");
dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});

const walletBalanceQueue = new Queue("wallet-balance", {
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

module.exports = walletBalanceQueue;
