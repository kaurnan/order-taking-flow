const { Worker } = require("bullmq");
const exchangeRateQueue = require("../../queues/exchange_rate.queue");
const { ServiceBroker } = require('moleculer');
const path = require('path');
const dotenv = require("dotenv");
const { default: Redis } = require("ioredis");

dotenv.config();

const broker = new ServiceBroker({
    logger: console,
    nodeID: `exchange-rate-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: exchange-rate-worker', process.env.TRANSPORTER);

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

const projectRoot = path.resolve(__dirname, '..');
broker.loadService(path.join(projectRoot, "../services/utility/exchange_rate.service.js"));

module.exports = async () => {
    const worker = new Worker(exchangeRateQueue.name, async (job) => {
        broker.logger.info(`Processing job ${job.id} from queue ${exchangeRateQueue.name}`);
        try {
            await broker.call("exchangeRate.fetchAndStoreRate");
            broker.logger.info(`Job ${job.id} completed: USD-INR rate updated.`);
        } catch (error) {
            broker.logger.error(`Job ${job.id} failed:`, error.message);
            throw error; // Re-throw to mark job as failed in BullMQ
        }
    }, {
        connection
    });

    worker.on("completed", (job) => {
        broker.logger.info(`Job ${job.id} has completed!`);
    });

    worker.on("failed", (job, err) => {
        broker.logger.error(`Job ${job.id} has failed with error ${err.message}`);
    });

    // Schedule the weekly job to fetch and store the exchange rate
    // This job will run every Sunday at 00:00 (midnight)
    exchangeRateQueue.add(
        "fetchWeeklyExchangeRate",
        {}, // No data needed for this job
        {
            repeat: {
                cron: "0 0 * * 0" // Every Sunday at 00:00
            },
            removeOnComplete: true,
            removeOnFail: false
        }
    ).then(() => {
        broker.logger.info("Weekly USD-INR exchange rate update job scheduled.");
    }).catch(err => {
        broker.logger.error("Failed to schedule weekly exchange rate job:", err.message);
    });

    return worker;
};
