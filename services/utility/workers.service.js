"use strict";

const shopifyCustomerSyncWorker = require("../../workers/core/shopifycustomer_sync.worker");
const sendMessageWorker = require("../../workers/core/send_message.worker");
const walletBalanceWorker = require("../../workers/core/wallet_balance.worker");
const invoiceWorker = require("../../workers/core/invoice.worker");
const broadcastBatchWorker = require("../../workers/core/broadcast_batch.worker");
const templateDeleteWorker = require("../../workers/core/template_delete.worker");
const mergeListWorker = require("../../workers/core/merge_list.worker");
const customerImportWorker = require("../../workers/core/customer_import.worker");
const bulkCustomerUpdateWorker = require("../../workers/core/bulk_customer_update.worker");
const profileExportWorker = require("../../workers/core/profile_export.worker");
const customerExportWorker = require("../../workers/core/customer_export.worker");
const exchangeRateWorker = require("../../workers/core/exchange_rate.worker");
const dailyUsageWorker = require("../../workers/core/daily_usage.worker");
// const exportCsvWorker = require("../../workers/export_csv_worker");

module.exports = {
    name: "workers",

    /**
     * Service settings
     */
    settings: {

    },

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {

    },

    /**
     * Events
     */
    events: {},

    /**
     * Methods
     */
    methods: {},

    /**
     * Service lifecycle events
     */
    created() {

    },

    async started() {
        this.logger.info("Starting BullMQ workers...");
        // Start the workers
        shopifyCustomerSyncWorker;
        sendMessageWorker;
        walletBalanceWorker;
        invoiceWorker;
        broadcastBatchWorker;
        templateDeleteWorker;
        mergeListWorker;
        customerImportWorker;
        bulkCustomerUpdateWorker;
        profileExportWorker;
        customerExportWorker;
        dailyUsageWorker;
        exchangeRateWorker;
        // exportCsvWorker;
        this.logger.info("BullMQ workers started.");
    },

    async stopped() {
        this.logger.info("Stopping BullMQ workers...");

        // Safely close workers that have close methods
        const workers = [
            { name: "shopifyCustomerSyncWorker", worker: shopifyCustomerSyncWorker },
            { name: "sendMessageWorker", worker: sendMessageWorker },
            { name: "walletBalanceWorker", worker: walletBalanceWorker },
            { name: "invoiceWorker", worker: invoiceWorker },
            { name: "broadcastBatchWorker", worker: broadcastBatchWorker },
            { name: "templateDeleteWorker", worker: templateDeleteWorker },
            { name: "mergeListWorker", worker: mergeListWorker },
            { name: "customerImportWorker", worker: customerImportWorker },
            { name: "bulkCustomerUpdateWorker", worker: bulkCustomerUpdateWorker, closeMethod: "closeWorker" },
            { name: "profileExportWorker", worker: profileExportWorker, closeMethod: "closeWorker" },
            { name: "customerExportWorker", worker: customerExportWorker, closeMethod: "closeWorker" },
            { name: "exchangeRateWorker", worker: exchangeRateWorker }, // Pass the broker instance
            { name: "dailyUsageWorker", worker: dailyUsageWorker } // Pass the broker instance
        ];

        for (const { name, worker, closeMethod } of workers) {
            try {
                if (worker && typeof worker[closeMethod || 'close'] === 'function') {
                    await worker[closeMethod || 'close']();
                    this.logger.info(`${name} stopped successfully`);
                } else {
                    this.logger.info(`${name} has no close method, skipping`);
                }
            } catch (error) {
                this.logger.warn(`Error stopping ${name}:`, error.message);
            }
        }

        this.logger.info("BullMQ workers stopped.");
    }
};
