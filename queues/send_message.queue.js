const { Queue } = require('bullmq');
const Redis = require("ioredis");
const dotenv = require("dotenv");
dotenv.config();

const connection = new Redis(process.env.REDIS_URI);

const sendMessageQueue = new Queue('send-broadcast-message', { connection });

module.exports = sendMessageQueue;
