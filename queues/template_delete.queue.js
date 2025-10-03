const { Queue } = require('bullmq');
const Redis = require("ioredis");
const dotenv = require("dotenv");
dotenv.config();

const connection = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});

const templateDeleteQueue = new Queue('template-delete-queue', { connection });

module.exports = templateDeleteQueue; 