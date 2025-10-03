const walletBalanceQueue = require("../../queues/wallet_balance.queue");

const walletBalanceJob = async (job) => {
    console.log("Checking wallet balance...");
    // TODO: Implement wallet balance check logic here
    return "Wallet balance check complete";
};

walletBalanceQueue.add(
    "check-wallet-balance",
    {},
    {
        repeat: {
            cron: "0 9 * * *", // Every morning at 9:00 AM
        },
    }
);

module.exports = walletBalanceJob;
