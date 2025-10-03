const ApiGateway = require("moleculer-web");
const DbMixin = require("../../mixins/db.mixin");
const axios = require("axios");

module.exports = {
    name: "exchangeRate",
    mixins: [DbMixin("exchange_rate")],

    settings: {
        // Define the API endpoint for fetching exchange rates
        exchangeRateApiUrl: "https://open.er-api.com/v6/latest/USD"
    },

    actions: {
        /**
         * Fetches the latest USD-INR exchange rate from an external API and stores it in the database.
         * @returns {Object} The newly stored exchange rate document.
         */
        fetchAndStoreRate: {
            async handler() {
                try {
                    this.logger.info("Fetching USD-INR exchange rate...");
                    const response = await axios.get(this.settings.exchangeRateApiUrl);
                    const { rates } = response.data;

                    if (!rates || typeof rates.INR === "undefined") {
                        throw new Error("INR rate not found in API response.");
                    }

                    const usdToInrRate = rates.INR;

                    // Update or insert the exchange rate
                    const doc = await this.adapter.model.findOneAndUpdate(
                        { currencyPair: "USD-INR" },
                        {
                            $set: {
                                rate: usdToInrRate,
                                timestamp: new Date()
                            }
                        },
                        {
                            upsert: true, // Create if not exists
                            new: true, // Return the updated document
                            setDefaultsOnInsert: true // Apply schema defaults on insert
                        }
                    );

                    this.logger.info(`USD-INR exchange rate updated: ${usdToInrRate}`);
                    return doc;
                } catch (error) {
                    this.logger.error("Error fetching and storing exchange rate:", error.message);
                    throw new ApiGateway.Errors.MoleculerError("Failed to fetch and store exchange rate", 500, "EXCHANGE_RATE_ERROR", { error: error.message });
                }
            }
        },

        /**
         * Retrieves the latest USD-INR exchange rate from the database.
         * @returns {Object} The latest exchange rate document.
         */
        getLatestRate: {
            cache: {
                keys: ["currencyPair"],
                ttl: 60 * 60 // Cache for 1 hour
            },
            async handler() {
                try {
                    const doc = await this.adapter.model.findOne({ currencyPair: "USD-INR" }).sort({ timestamp: -1 });
                    if (!doc) {
                        this.logger.warn("No USD-INR exchange rate found in database.");
                        return null;
                    }
                    return doc;
                } catch (error) {
                    this.logger.error("Error retrieving latest exchange rate:", error.message);
                    throw new ApiGateway.Errors.MoleculerError("Failed to retrieve latest exchange rate", 500, "EXCHANGE_RATE_ERROR", { error: error.message });
                }
            }
        }
    },

    methods: {
        /**
         * Seed the database with an initial USD-INR entry if it doesn't exist.
         */
        async seedDB() {
            const count = await this.adapter.model.countDocuments();
            if (count === 0) {
                this.logger.info("Seeding ExchangeRate collection with initial USD-INR entry.");
                await this.adapter.model.create({
                    currencyPair: "USD-INR",
                    rate: 80, // Default initial rate, will be updated by the worker
                    timestamp: new Date()
                });
            }
        }
    },

    async afterConnected() {
        await this.seedDB();
    }
};
