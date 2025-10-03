const { Queue } = require("bullmq");
const { default: Redis } = require("ioredis");
dotenv = require("dotenv");

dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});

const exchangeRateQueue = new Queue("exchangeRateQueue", {
    connection
});

module.exports = exchangeRateQueue;
