const { Worker } = require("bullmq");
const walletBalanceJob = require("../jobs/wallet_balance.job");
const Redis = require("ioredis");
const dotenv = require('dotenv');

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

const worker = new Worker("wallet-balance", walletBalanceJob, {
    connection,
    autorun: true,
});

worker.on("completed", (job) => {
    console.log(`${job.id} has completed!`);
});

worker.on("failed", (job, err) => {
    console.log(`${job.id} has failed with ${err.message}`);
});

module.exports = worker;
