const { Worker } = require("bullmq");
const { connectMongo } = require("../../mixins/db");
const axios = require("axios");
const Organisation = require("../../models/ums/organisation.model");
const DailyUsage = require("../../models/billing/daily_account_usage.model");
const MonthlyUsage = require("../../models/billing/monthy_account_usgae.model");
const Transaction = require("../../models/transaction.model"); // Import Transaction model
const ExchangeRate = require("../../models/exchange_rate.model"); // Import ExchangeRate model
const Channel = require("../../models/channel.model"); // Import Channel model
const { default: Redis } = require("ioredis");
const dotenv = require("dotenv");


dotenv.config();

(async () => {
    await connectMongo();
    console.log("Mongo ready for daily_usage");
})().catch(err => {
    console.error("Mongo connect error (daily_usage):", err);
    process.exit(1);
});

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

/**
 * Fetches the exchange rate from a source currency to a target currency.
 *
 * @async
 * @function getExchangeRate
 * @param {string} fromCurrency - The currency code to convert from (e.g., "INR").
 * @param {string} toCurrency - The currency code to convert to (e.g., "USD").
 * @returns {Promise<number>} The exchange rate. Defaults to 1 if no rate is found or an error occurs.
 */
async function getExchangeRate(fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
        return 1;
    }

    try {
        // Case 1: Direct conversion rate from target to source (e.g., USD-INR, rate is INR per USD)
        let exchangeRateDoc = await ExchangeRate.findOne({
            currencyPair: `${toCurrency}-${fromCurrency}`,
        }).sort({ timestamp: -1 }); // Get the latest rate

        if (exchangeRateDoc) {
            // If we have USD-INR rate, and we want to convert INR to USD, we divide by the rate
            return 1 / exchangeRateDoc.rate;
        }

        // Case 2: Direct conversion rate from source to target (e.g., INR-USD, rate is USD per INR)
        exchangeRateDoc = await ExchangeRate.findOne({
            currencyPair: `${fromCurrency}-${toCurrency}`,
        }).sort({ timestamp: -1 }); // Get the latest rate

        if (exchangeRateDoc) {
            // If we have INR-USD rate, and we want to convert INR to USD, we multiply by the rate
            return exchangeRateDoc.rate;
        }

        console.warn(`Exchange rate not found for ${fromCurrency} to ${toCurrency}. Defaulting to 1.`);
        return 1; // Default to 1 if no rate is found
    } catch (error) {
        console.error(`Error fetching exchange rate for ${fromCurrency} to ${toCurrency}:`, error.message);
        return 1;
    }
}

/**
 * Worker instance for processing daily usage jobs from the "dailyUsageQueue".
 *
 * This worker listens to the "dailyUsageQueue" and processes jobs that contain
 * organisation-specific daily usage data. For each job, it extracts the `org_id`
 * and `date` from the job data, then calls `processDailyUsageForOrganisation`
 * to handle the business logic. Results and errors are logged for monitoring.
 *
 * @constant
 * @type {Worker}
 * @param {Object} job - The job object containing data for processing.
 * @param {string|number} job.id - Unique identifier for the job.
 * @param {Object} job.data - Data payload for the job.
 * @param {string} job.data.org_id - The organisation ID to process usage for.
 * @param {string} job.data.date - The date for which to process usage.
 * @returns {Promise<any>} The result of the daily usage processing.
 *
 * @throws {Error} If processing fails, the error is logged and re-thrown.
 *
 * @example
 * // Enqueue a job to process daily usage for an organisation
 * queue.add("dailyUsageQueue", { org_id: "org123", date: "2024-06-10" });
 */
const dailyUsageWorker = new Worker(
    "dailyUsageQueue",
    async (job) => {
        console.log("Processing daily usage job:", job.id);
        const { org_id, date } = job.data;

        try {
            // Process daily usage for the specific organisation
            const result = await processDailyUsageForOrganisation(org_id, date);
            console.log(`Daily usage processed for organisation ${org_id}:`, result);
            return result;
        } catch (error) {
            console.error(`Error processing daily usage for organisation ${org_id}:`, error.message);
            throw error;
        }
    },
    {
        connection,
        concurrency: 5, // Process up to 5 jobs concurrently
    }
);

/**
 * Processes daily usage analytics for all channels of a given organisation for a specific date.
 *
 * This function:
 * - Retrieves the organisation by its ID.
 * - Fetches all non-deleted channels associated with the organisation.
 * - For each channel, fetches analytics data from the respective BSP (Gupshup or Interakt) for the previous day.
 * - Extracts usage metrics (marketing, utility, authentication, service, conversations, messages) from analytics data.
 * - Stores daily usage and updates monthly usage records.
 * - Accumulates total usage statistics across all channels.
 *
 * @async
 * @function
 * @param {string} org_id - The unique identifier of the organisation.
 * @param {string|Date} date - The date (ISO string or Date object) for which to process usage (usage is calculated for the previous day).
 * @returns {Promise<Object>} An object containing the processing result, including organisation name, processed channel count, and total usage statistics.
 * @throws {Error} If the organisation is not found or if an error occurs during processing.
 */
async function processDailyUsageForOrganisation(org_id, date) {
    try {
        // Get the organisation
        const organisation = await Organisation.findById(org_id);
        if (!organisation) {
            throw new Error(`Organisation not found: ${org_id}`);
        }

        // Get all channels for the organisation
        const channels = await Channel.find({
            org_id: org_id,
            deleted: { $ne: true } // Exclude deleted channels
        });

        if (!channels || channels.length === 0) {
            console.log(`No channels found for organisation: ${organisation.name} (${org_id})`);
            return {
                success: true,
                message: "No channels found",
                organisation: organisation.name,
                processed_channels: 0
            };
        }

        const targetDate = new Date(date);
        const previousDate = new Date(targetDate);
        previousDate.setDate(previousDate.getDate() - 2);
        const startDate = previousDate.toISOString().split('T')[0];
        targetDate.setDate(targetDate.getDate() - 1);
        const endDate = targetDate.toISOString().split('T')[0];

        let processedChannels = 0;
        console.log("channels", channels.length)

        let aggregatedUsage = [];

        // Process each channel
        for (const channel of channels) {
            try {
                if (channel.bsp === "gupshup") {
                    // Fetch from Gupshup
                    analyticsData = await fetchGupshupAnalytics(
                        channel.waba_id,
                        channel.phone_number_details.id,
                        startDate,
                        endDate,
                        channel.additional?.app_id,
                        channel.additional?.token
                    );
                } else if (channel.bsp === "interakt") {
                    // Fetch from Interakt
                    analyticsData = await fetchInteraktAnalytics(
                        channel.waba_id,
                        channel.phone_number_details.id,
                        startDate,
                        endDate
                    );
                }

                if (analyticsData) {
                    // Extract usage data
                    console.log(JSON.stringify(analyticsData, null, 2));
                    const usageData = extractUsageFromAnalytics(analyticsData, channel.bsp);
                    aggregatedUsage.push(usageData);
                    processedChannels++;
                }
            } catch (channelError) {
                console.error(`Error processing channel ${channel._id}:`, channelError.message);
                continue;
            }
        }

        // Store daily usage
        await storeDailyUsage(org_id, previousDate, aggregatedUsage);
        // Update monthly usage
        await updateMonthlyUsage(org_id, previousDate, aggregatedUsage);

        // Record usage transaction for Interakt data
        // Aggregate Interakt usage for transaction
        let aggregatedTransactionCost = 0;
        let aggregatedTransactionVolume = 0;
        let aggregatedTransactionItems = [];

        for (const channel of channels) {
            if (channel.bsp === "interakt" && channel.analyticsData && channel.analyticsData.pricing_analytics && channel.analyticsData.pricing_analytics.data) {
                const usageItems = channel.analyticsData.pricing_analytics.data;
                usageItems.forEach(item => {
                    aggregatedTransactionCost += item.cost || 0;
                    aggregatedTransactionVolume += item.volume || 0;
                    aggregatedTransactionItems.push({
                        ...item,
                        channel_id: channel._id,
                        phone_number: channel.phone_number_details?.display_phone_number,
                    });
                });
            }
        }

        if (aggregatedTransactionCost > 0) {
            const transactionCurrency = channels.find(c => c.bsp === "interakt" && c.currency)?.currency || "INR";
            const exchangeRate = await getExchangeRate(transactionCurrency, "USD");
            const amountInUSD = aggregatedTransactionCost * exchangeRate;

            await Transaction.create({
                amount: amountInUSD,
                type: "usage_debit",
                status: "completed",
                date: previousDate,
                description: `Aggregated daily usage debit for Interakt channels on ${startDate}`,
                userId: organisation.owner,
                org_id: org_id,
                currency: "USD",
                metadata: {
                    original_currency: transactionCurrency,
                    original_amount: aggregatedTransactionCost,
                    total_volume: aggregatedTransactionVolume,
                    usage_data_items: aggregatedTransactionItems,
                    date: previousDate,
                },
            });
            console.log(`Aggregated usage transaction recorded for organisation ${organisation.name}`);
        }

        return {
            success: true,
            message: `Daily usage processed successfully for organisation: ${organisation.name}`,
            organisation: organisation.name,
            date: startDate,
            processed_channels: processedChannels,
        };

    } catch (error) {
        console.error("Error processing daily usage for organisation:", error.message);
        throw error;
    }
}

/**
 * Fetches daily analytics data from the Gupshup Partner API for a specific WABA and phone number.
 *
 * @async
 * @function fetchGupshupAnalytics
 * @param {string} waba_id - The WhatsApp Business Account (WABA) ID.
 * @param {string} phone_number_id - The phone number ID associated with the WABA.
 * @param {string|Date} start_date - The start date for the analytics range (ISO string or Date object).
 * @param {string|Date} end_date - The end date for the analytics range (ISO string or Date object).
 * @param {string} app_id - The Gupshup application ID.
 * @param {string} token - The authorization token for the Gupshup API.
 * @returns {Promise<Object|null>} Resolves with the analytics data object if successful, or null if an error occurs or credentials are missing.
 *
 * @throws {Error} Logs and returns null if the API call fails or required parameters are missing.
 *
 * @example
 * const analytics = await fetchGupshupAnalytics(
 *   "waba123",
 *   "phone456",
 *   "2024-06-01",
 *   "2024-06-07",
 *   "app789",
 *   "Bearer your_token"
 * );
 */
async function fetchGupshupAnalytics(waba_id, phone_number_id, start_date, end_date, app_id, token) {
    try {
        if (!app_id || !token) {
            console.warn("Missing Gupshup app_id or token for channel");
            return null;
        }

        const startUnix = Math.floor(new Date(start_date).getTime() / 1000);
        const endUnix = Math.floor(new Date(end_date).getTime() / 1000);

        const url = `${process.env.GUPSHUP_PARTNER_API}/partner/app/${app_id}/v3/analytics/conversations`;
        const payload = {
            waba_id,
            phone_number_id,
            start_date: startUnix,
            end_date: endUnix,
            granularity: "daily"
        };

        const response = await axios.post(url, payload, {
            headers: {
                Authorization: token,
                "Content-Type": "application/json"
            }
        });

        return response.data;
    } catch (error) {
        console.error("Error fetching Gupshup analytics:", error.message);
        return null;
    }
}

/**
 * Fetches conversation analytics data from the Interakt API for a specific WABA and phone number within a date range.
 *
 * @async
 * @function fetchInteraktAnalytics
 * @param {string} waba_id - The WhatsApp Business Account (WABA) ID.
 * @param {string} phone_number_id - The phone number ID to fetch analytics for.
 * @param {string|Date} start_date - The start date of the analytics period (ISO string or Date object).
 * @param {string|Date} end_date - The end date of the analytics period (ISO string or Date object).
 * @returns {Promise<Object|null>} Resolves with the analytics data object if successful, or null if an error occurs.
 *
 * @throws Will log an error message to the console if the API request fails.
 *
 * @example
 * const data = await fetchInteraktAnalytics('waba123', 'phone456', '2024-06-01', '2024-06-07');
 * if (data) {
 *   // Process analytics data
 * }
 */
async function fetchInteraktAnalytics(waba_id, phone_number_id, start_date, end_date) {
    try {
        const startUnix = Math.floor(new Date(start_date).getTime() / 1000);
        const endUnix = Math.floor(new Date(end_date).getTime() / 1000);

        console.log(startUnix, endUnix)

        const url = `${process.env.INTERAKT_API}/${waba_id}?fields=conversation_analytics.start(${startUnix}).end(${endUnix}).granularity(DAILY).phone_numbers(["${phone_number_id}"]).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY","PHONE"])`;

        const response = await axios.get(url, {
            headers: {
                "x-access-token": process.env.INTERAKT_TOKEN,
                "x-waba-id": waba_id,
                "Content-Type": "application/json"
            }
        });

        return response.data;
    } catch (error) {
        console.log('from core', error?.response?.data || error.message);
        console.error("Error fetching Interakt analytics:", error.message);
        return null;
    }
}

/**
 * Extracts usage statistics from analytics data for a given BSP (Business Service Provider).
 *
 * Supports parsing analytics data from "gupshup" and "interakt" BSPs, extracting conversation and message counts,
 * as well as counts for specific conversation categories: marketing, utility, authentication, and service.
 *
 * @param {Object} analyticsData - The analytics data object to extract usage from. The structure varies depending on the BSP.
 * @param {string} bsp - The identifier for the BSP ("gupshup" or "interakt").
 * @returns {Object} An object containing usage statistics:
 *   @property {number} marketing - Count of marketing conversations.
 *   @property {number} utility - Count of utility conversations.
 *   @property {number} authentication - Count of authentication conversations.
 *   @property {number} service - Count of service conversations.
 *   @property {number} conversation_count - Total number of conversations.
 *   @property {number} message_count - Total number of messages.
 *
 * @throws Will log an error to the console if extraction fails.
 */
function extractUsageFromAnalytics(analyticsData, bsp) {
    let usage = {
        marketing: {
            qty: 0,
            totalCost: 0
        },
        freeMarketing: {
            qty: 0,
            totalCost: 0
        },
        utility: {
            qty: 0,
            totalCost: 0
        },
        freeUtility: {
            qty: 0,
            totalCost: 0
        },
        authentication: {
            qty: 0,
            totalCost: 0
        },
        freeAuthentication: {
            qty: 0,
            totalCost: 0
        },
        service: {
            qty: 0,
            totalCost: 0
        },
        freeService: {
            qty: 0,
            totalCost: 0
        },
        conversation_count: 0,
        message_count: 0
    };

    try {
        if (bsp === "gupshup") {
            // Parse Gupshup analytics format
            if (analyticsData.conversations) {
                usage.conversation_count = analyticsData.conversations.total || 0;
                usage.message_count = analyticsData.conversations.messages || 0;

                // Parse conversation categories if available
                // if (analyticsData.conversations.categories) {
                //     usage.marketing = analyticsData.conversations.categories.marketing || 0;
                //     usage.utility = analyticsData.conversations.categories.utility || 0;
                //     usage.authentication = analyticsData.conversations.categories.authentication || 0;
                //     usage.service = analyticsData.conversations.categories.service || 0;
                // }
            }
        } else if (bsp === "interakt") {
            // Parse Interakt analytics format
            if (analyticsData.pricing_analytics && analyticsData.pricing_analytics.data?.length) {
                const data = analyticsData.pricing_analytics.data[0].data_points;

                // Sum up all metrics
                data.forEach(item => {
                    if (item) {
                        const pricing_type = item.pricing_type;
                        const pricing_category = item.pricing_category;
                        const volume = item.volume;
                        const cost = item.cost;

                        // usage.conversation_count += item.values.conversation_count || 0;
                        usage.message_count += volume || 0;

                        switch (pricing_type) {
                            case "FREE_CUSTOMER_SERVICE":
                                if (pricing_category === "SERVICE") {
                                    usage.freeService.qty += volume || 0;
                                    usage.freeService.totalCost += cost || 0;
                                }
                                break;
                            case "REGULAR":
                                switch (pricing_category) {
                                    case "MARKETING":
                                        usage.marketing.qty += volume || 0;
                                        usage.marketing.totalCost += cost || 0;
                                        break;
                                    case "UTILITY":
                                        usage.utility.qty += volume || 0;
                                        usage.utility.totalCost += cost || 0;
                                        break;
                                    case "AUTHENTICATION":
                                        usage.authentication.qty += volume || 0;
                                        usage.authentication.totalCost += cost || 0;
                                        break;
                                }
                                break;
                            default:
                                break;
                        }
                    }
                });
            }
        }
    } catch (error) {
        console.error("Error extracting usage data:", error.message);
    }

    return usage;
}

/**
 * Stores or updates the daily usage statistics for a specific organization, channel, and BSP on a given date.
 *
 * If a usage record for the specified date already exists, it updates the existing record with the new usage data.
 * Otherwise, it creates a new usage record.
 *
 * @async
 * @function storeDailyUsage
 * @param {string|mongoose.Types.ObjectId} org_id - The unique identifier of the organization.
 * @param {string|mongoose.Types.ObjectId} channel_id - The unique identifier of the channel.
 * @param {string} bsp - The BSP (Business Service Provider) identifier.
 * @param {Date} date - The date for which the usage data is being stored.
 * @param {Array} usageData - The usage statistics to store.
 * @param {number} usageData.marketing - The marketing usage count.
 * @param {number} usageData.utility - The utility usage count.
 * @param {number} usageData.authentication - The authentication usage count.
 * @param {number} usageData.service - The service usage count.
 * @param {number} usageData.conversation_count - The number of conversations.
 * @param {number} usageData.message_count - The number of messages.
 * @returns {Promise<void>} Resolves when the operation is complete.
 * @throws {Error} Throws an error if storing or updating the usage data fails.
 */
async function storeDailyUsage(org_id, date, usageData) {
    try {
        // Check if daily usage already exists for this date
        const existingUsage = await DailyUsage.findOne({
            org_id,
            date: {
                $gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
                $lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
            }
        });

        console.log('usageData', JSON.stringify(usageData))
        console.log('going to update daily usage', JSON.stringify(existingUsage))
        let aggregatedData = {}
        for (const data of usageData) {
            if (existingUsage) {

                existingUsage.marketing.qty += data.marketing.qty || 0;
                existingUsage.marketing.totalCost += data.marketing.totalCost || 0;

                existingUsage.utility.qty += data.utility.qty || 0;
                existingUsage.utility.totalCost += data.utility.totalCost || 0;

                existingUsage.authentication.qty += data.authentication.qty || 0;
                existingUsage.authentication.totalCost += data.authentication.totalCost || 0;

                existingUsage.freeService.qty += data.service.qty || 0;
                existingUsage.freeService.totalCost += data.service.totalCost || 0;

                existingUsage.conversation_count += data.conversation_count || 0;
                existingUsage.message_count += data.message_count || 0;


            } else {
                aggregatedData.marketing.qty += data.marketing.qty || 0;
                aggregatedData.marketing.totalCost += data.marketing.totalCost || 0;

                aggregatedData.utility.qty += data.utility.qty || 0;
                aggregatedData.utility.totalCost += data.utility.totalCost || 0;

                aggregatedData.authentication.qty += data.authentication.qty || 0;
                aggregatedData.authentication.totalCost += data.authentication.totalCost || 0;

                aggregatedData.freeService.qty += data.service.qty || 0;
                aggregatedData.freeService.totalCost += data.service.totalCost || 0;

                aggregatedData.conversation_count += data.conversation_count || 0;
                aggregatedData.message_count += data.message_count || 0;

            }
        }
        if (existingUsage) {
            await existingUsage.save();
        }
        else {

            await DailyUsage.create({
                org_id,
                date,
                ...aggregatedData
            });
        }

    } catch (error) {
        console.log(error)
        console.error("Error storing daily usage:", error.message);
        throw error;
    }
}

/**
 * Updates or creates a monthly usage record for a given organization, channel, and BSP.
 *
 * If a record for the specified month and year exists, increments its usage fields with the provided data.
 * Otherwise, creates a new monthly usage record with the given details.
 *
 * @async
 * @function updateMonthlyUsage
 * @param {string} org_id - The unique identifier of the organization.
 * @param {string} channel_id - The unique identifier of the channel.
 * @param {string} bsp - The business service provider identifier.
 * @param {Date} date - The date object used to determine the month and year for the usage record.
 * @param {Object} usageData - The usage data to update or insert.
 * @param {number} usageData.marketing - The number of marketing messages.
 * @param {number} usageData.utility - The number of utility messages.
 * @param {number} usageData.authentication - The number of authentication messages.
 * @param {number} usageData.service - The number of service messages.
 * @param {number} usageData.conversation_count - The number of conversations.
 * @param {number} usageData.message_count - The total number of messages.
 * @throws {Error} Throws an error if the update or creation fails.
 */
async function updateMonthlyUsage(org_id, date, usageData) {
    try {
        const month = date.getMonth() + 1; // getMonth() returns 0-11
        const year = date.getFullYear();

        // Check if monthly usage already exists for this org, month, and year
        const existingMonthlyUsage = await MonthlyUsage.findOne({
            org_id,
            month,
            year
        });

        let aggregatedData = {
            marketing: { qty: 0, totalCost: 0 },
            utility: { qty: 0, totalCost: 0 },
            authentication: { qty: 0, totalCost: 0 },
            freeService: { qty: 0, totalCost: 0 },
            conversation_count: 0,
            message_count: 0
        };

        for (const data of usageData) {
            if (existingMonthlyUsage) {
                existingMonthlyUsage.marketing.qty += data.marketing.qty || 0;
                existingMonthlyUsage.marketing.totalCost += data.marketing.totalCost || 0;

                existingMonthlyUsage.utility.qty += data.utility.qty || 0;
                existingMonthlyUsage.utility.totalCost += data.utility.totalCost || 0;

                existingMonthlyUsage.authentication.qty += data.authentication.qty || 0;
                existingMonthlyUsage.authentication.totalCost += data.authentication.totalCost || 0;

                existingMonthlyUsage.freeService.qty += data.service.qty || 0;
                existingMonthlyUsage.freeService.totalCost += data.service.totalCost || 0;

                existingMonthlyUsage.conversation_count += data.conversation_count || 0;
                existingMonthlyUsage.message_count += data.message_count || 0;
            } else {
                aggregatedData.marketing.qty += data.marketing.qty || 0;
                aggregatedData.marketing.totalCost += data.marketing.totalCost || 0;

                aggregatedData.utility.qty += data.utility.qty || 0;
                aggregatedData.utility.totalCost += data.utility.totalCost || 0;

                aggregatedData.authentication.qty += data.authentication.qty || 0;
                aggregatedData.authentication.totalCost += data.authentication.totalCost || 0;

                aggregatedData.freeService.qty += data.service.qty || 0;
                aggregatedData.freeService.totalCost += data.service.totalCost || 0;

                aggregatedData.conversation_count += data.conversation_count || 0;
                aggregatedData.message_count += data.message_count || 0;
            }
        }

        if (existingMonthlyUsage) {
            await existingMonthlyUsage.save();
        } else {
            await MonthlyUsage.create({
                org_id,
                month,
                year,
                ...aggregatedData
            });
        }
    } catch (error) {
        console.error("Error updating monthly usage:", error.message);
        throw error;
    }
}

// Event handlers
dailyUsageWorker.on("completed", (job) => {
    console.log(`Daily usage job ${job.id} completed successfully!`);
});

dailyUsageWorker.on("failed", (job, err) => {
    console.error(`Daily usage job ${job.id} failed:`, err.message);
});

dailyUsageWorker.on("error", (err) => {
    console.error("Daily usage worker error:", err.message);
});

module.exports = dailyUsageWorker;
