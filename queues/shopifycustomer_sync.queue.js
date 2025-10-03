const { Queue } = require('bullmq');
const Redis = require("ioredis");
const dotenv = require("dotenv");
dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});

const shopifyCustomerSyncQueue = new Queue('shopify-customer-sync', { connection });

module.exports = shopifyCustomerSyncQueue;
