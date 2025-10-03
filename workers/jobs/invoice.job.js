const invoiceCreationQueue = require("../../queues/invoice.queue");

const invoiceCreationJob = async (job) => {
    console.log("Checking invoice creation...");
    // TODO: Implement invoice creation logic here
    return "Invoice creation check complete";
};

invoiceCreationQueue.add(
    "invoice-creation",
    {},
    {
        repeat: {
            cron: "0 0 1 * *", // Run at 00:00 on the 1st of every month
        },
        removeOnComplete: true,
        removeOnFail: false,
    }
);

module.exports = invoiceCreationJob;
