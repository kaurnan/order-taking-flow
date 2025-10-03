"use strict";

const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const axios = require("axios");

module.exports = {
    name: "daily_usage",
    mixins: [dbMixin("billing/daily_account_usage")],
    settings: {
        // Service settings
    },
    dependencies: ["ums_organisation", "channel"],
    actions: {
        /**
         * Fetch conversation analytics from Gupshup for a specific date range
         */
        fetchGupshupAnalytics: {
            params: {
                waba_id: { type: "string", required: true },
                phone_number_id: { type: "string", required: true },
                start_date: { type: "string", required: true }, // ISO date string
                end_date: { type: "string", required: true },   // ISO date string
                app_id: { type: "string", required: true },
                token: { type: "string", required: true }
            },
            async handler(ctx) {
                const { waba_id, phone_number_id, start_date, end_date, app_id, token } = ctx.params;

                try {
                    // Convert dates to Unix timestamps
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

                    return {
                        success: true,
                        data: response.data
                    };
                } catch (error) {
                    this.logger.error("Error fetching Gupshup analytics:", error.message);
                    throw new MoleculerError("Failed to fetch Gupshup analytics", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Fetch conversation analytics from Interakt for a specific date range
         */
        fetchInteraktAnalytics: {
            params: {
                waba_id: { type: "string", required: true },
                phone_number_id: { type: "string", required: true },
                start_date: { type: "string", required: true }, // ISO date string
                end_date: { type: "string", required: true }   // ISO date string
            },
            async handler(ctx) {
                const { waba_id, phone_number_id, start_date, end_date } = ctx.params;

                try {
                    // Convert dates to Unix timestamps
                    const startUnix = Math.floor(new Date(start_date).getTime() / 1000);
                    const endUnix = Math.floor(new Date(end_date).getTime() / 1000);
                    const url = `${process.env.INTERAKT_API}/${waba_id}?fields=conversation_analytics.start(${startUnix}).end(${endUnix}).granularity(DAILY).phone_numbers(["${phone_number_id}"]).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY","PHONE"])`;

                    const response = await axios.get(url, {
                        headers: {
                            "x-access-token": process.env.INTERAKT_TOKEN,
                            "x-waba-id": waba_id,
                            "Content-Type": "application/json"
                        }
                    });

                    return {
                        success: true,
                        data: response.data
                    };
                } catch (error) {
                    this.logger.error("Error fetching Interakt analytics:", error.message);
                    throw new MoleculerError("Failed to fetch Interakt analytics", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Fetch conversation analytics from Gupshup for a specific date range
         */
        fetchGupshupAnalytics: {
            params: {
                waba_id: { type: "string", required: true },
                phone_number_id: { type: "string", required: true },
                start_date: { type: "string", required: true }, // ISO date string
                end_date: { type: "string", required: true }   // ISO date string
            },
            async handler(ctx) {
                const { waba_id, phone_number_id, start_date, end_date } = ctx.params;

                try {
                    // Convert dates to Unix timestamps
                    const startUnix = Math.floor(new Date(start_date).getTime() / 1000);
                    const endUnix = Math.floor(new Date(end_date).getTime() / 1000);

                    const url = `${process.env.GUPSHUP_PARTNER_API}/partner/app/${waba_id}/v3/analytics/conversations`;

                    const response = await axios.get(url, {
                        headers: {
                            "Authorization": process.env.GUPSHUP_TOKEN,
                            "Content-Type": "application/json"
                        },
                        params: {
                            start_date: startUnix,
                            end_date: endUnix,
                            granularity: "daily"
                        }
                    });

                    return {
                        success: true,
                        data: response.data
                    };
                } catch (error) {
                    this.logger.error("Error fetching Gupshup analytics:", error.message);
                    throw new MoleculerError("Failed to fetch Gupshup analytics", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Process daily usage for a specific organisation and date
         */
        processDailyUsage: {
            params: {
                org_id: { type: "string", required: true },
                date: { type: "string", required: true } // ISO date string
            },
            async handler(ctx) {
                const { org_id, date } = ctx.params;

                try {
                    // Get all channels for the organisation
                    const channels = await ctx.call("channel.getChannelsByOrgId", { org_id });

                    if (!channels || channels.length === 0) {
                        this.logger.info(`No channels found for organisation: ${org_id}`);
                        return { success: true, message: "No channels found" };
                    }

                    const targetDate = new Date(date);
                    const previousDate = new Date(targetDate);

                    const startDate = previousDate.toISOString().split('T')[0];
                    console.log('startDate', startDate)
                    previousDate.setDate(previousDate.getDate() - 1);
                    const endDate = previousDate.toISOString().split('T')[0];
                    console.log('endDate', endDate);
                    let processedChannels = 0;

                    for (const channel of channels) {
                        try {
                            let analyticsData = null;

                            if (channel.bsp === "gupshup") {
                                // Fetch from Gupshup
                                const gupshupResponse = await ctx.call("daily_usage.fetchGupshupAnalytics", {
                                    waba_id: channel.waba_id,
                                    phone_number_id: channel.phone_number_details.id,
                                    start_date: startDate,
                                    end_date: endDate,
                                    app_id: channel.additional?.app_id,
                                    token: channel.additional?.token
                                });

                                if (gupshupResponse.success) {
                                    analyticsData = gupshupResponse.data;
                                }
                            } else if (channel.bsp === "interakt") {
                                // Fetch from Interakt
                                const interaktResponse = await ctx.call("daily_usage.fetchInteraktAnalytics", {
                                    waba_id: channel.waba_id,
                                    phone_number_id: channel.phone_number_details.id,
                                    start_date: startDate,
                                    end_date: endDate
                                });

                                if (interaktResponse.success) {
                                    analyticsData = interaktResponse.data;
                                }
                            }

                            if (analyticsData) {
                                // Process and store daily usage
                                await this.storeDailyUsage(ctx, {
                                    org_id,
                                    channel_id: channel._id,
                                    bsp: channel.bsp,
                                    date: previousDate,
                                    analytics_data: analyticsData
                                });

                                // Update monthly usage
                                await this.updateMonthlyUsage(ctx, {
                                    org_id,
                                    channel_id: channel._id,
                                    bsp: channel.bsp,
                                    date: previousDate,
                                    analytics_data: analyticsData
                                });

                                processedChannels++;
                            }
                        } catch (channelError) {
                            this.logger.error(`Error processing channel ${channel._id}:`, channelError.message);
                            continue;
                        }
                    }

                    return {
                        success: true,
                        message: `Processed ${processedChannels} channels for organisation ${org_id}`,
                        processed_channels: processedChannels
                    };

                } catch (error) {
                    this.logger.error("Error processing daily usage:", error.message);
                    throw new MoleculerError("Failed to process daily usage", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Store daily usage data
         */
        storeDailyUsage: {
            params: {
                org_id: { type: "string", required: true },
                channel_id: { type: "string", required: true },
                bsp: { type: "string", required: true },
                date: { type: "date", required: true },
                analytics_data: { type: "object", required: true }
            },
            async handler(ctx) {
                const { org_id, channel_id, bsp, date, analytics_data } = ctx.params;

                try {
                    // Extract usage data from analytics
                    const usageData = this.extractUsageFromAnalytics(analytics_data, bsp);

                    // Check if daily usage already exists for this date
                    const existingUsage = await this.adapter.model.findOne({
                        org_id,
                        channel_id,
                        bsp,
                        date: {
                            $gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
                            $lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
                        }
                    });

                    if (existingUsage) {
                        // Update existing record
                        existingUsage.marketing = usageData.marketing;
                        existingUsage.freeMarketing = usageData.freeMarketing;
                        existingUsage.utility = usageData.utility;
                        existingUsage.freeUtility = usageData.freeUtility;
                        existingUsage.authentication = usageData.authentication;
                        existingUsage.freeAuthentication = usageData.freeAuthentication;
                        existingUsage.freeService = usageData.freeService; // Only freeService
                        existingUsage.users = usageData.users;
                        existingUsage.channels = usageData.channels;
                        existingUsage.branches = usageData.branches;
                        existingUsage.conversation_count = usageData.conversation_count;
                        existingUsage.message_count = usageData.message_count;
                        existingUsage.total_cost = usageData.total_cost;
                        existingUsage.country_wise_data = usageData.country_wise_data;
                        await existingUsage.save();
                    } else {
                        // Create new record
                        await this.adapter.insert({
                            org_id,
                            channel_id,
                            bsp,
                            date,
                            marketing: usageData.marketing,
                            freeMarketing: usageData.freeMarketing,
                            utility: usageData.utility,
                            freeUtility: usageData.freeUtility,
                            authentication: usageData.authentication,
                            freeAuthentication: usageData.freeAuthentication,
                            freeService: usageData.freeService, // Only freeService
                            users: usageData.users,
                            channels: usageData.channels,
                            branches: usageData.branches,
                            conversation_count: usageData.conversation_count,
                            message_count: usageData.message_count,
                            total_cost: usageData.total_cost,
                            country_wise_data: usageData.country_wise_data
                        });
                    }

                    return { success: true, message: "Daily usage stored successfully" };
                } catch (error) {
                    this.logger.error("Error storing daily usage:", error.message);
                    throw new MoleculerError("Failed to store daily usage", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Update monthly usage data
         */
        updateMonthlyUsage: {
            params: {
                org_id: { type: "string", required: true },
                channel_id: { type: "string", required: true },
                bsp: { type: "string", required: true },
                date: { type: "date", required: true },
                analytics_data: { type: "object", required: true }
            },
            async handler(ctx) {
                const { org_id, channel_id, bsp, date, analytics_data } = ctx.params;

                try {
                    const month = date.getMonth() + 1; // getMonth() returns 0-11
                    const year = date.getFullYear();

                    // Extract usage data from analytics
                    const usageData = this.extractUsageFromAnalytics(analytics_data, bsp);

                    // Check if monthly usage already exists
                    const MonthlyUsage = require("../../models/billing/monthy_account_usgae.model");
                    const existingMonthlyUsage = await MonthlyUsage.findOne({
                        org_id,
                        channel_id,
                        bsp,
                        month,
                        year
                    });

                    if (existingMonthlyUsage) {
                        // Update existing monthly record
                        // Handle new structure with qty and totalCost
                        if (existingMonthlyUsage.marketing && typeof existingMonthlyUsage.marketing === 'object') {
                            existingMonthlyUsage.marketing.qty = (existingMonthlyUsage.marketing.qty || 0) + (usageData.marketing.qty || 0);
                            existingMonthlyUsage.marketing.totalCost = (existingMonthlyUsage.marketing.totalCost || 0) + (usageData.marketing.totalCost || 0);
                        } else {
                            existingMonthlyUsage.marketing = { qty: (existingMonthlyUsage.marketing || 0) + (usageData.marketing.qty || 0), totalCost: (usageData.marketing.totalCost || 0) };
                        }
                        if (existingMonthlyUsage.freeMarketing && typeof existingMonthlyUsage.freeMarketing === 'object') {
                            existingMonthlyUsage.freeMarketing.qty = (existingMonthlyUsage.freeMarketing.qty || 0) + (usageData.freeMarketing.qty || 0);
                            existingMonthlyUsage.freeMarketing.totalCost = (existingMonthlyUsage.freeMarketing.totalCost || 0) + (usageData.freeMarketing.totalCost || 0);
                        } else {
                            existingMonthlyUsage.freeMarketing = { qty: (existingMonthlyUsage.freeMarketing || 0) + (usageData.freeMarketing.qty || 0), totalCost: (usageData.freeMarketing.totalCost || 0) };
                        }

                        if (existingMonthlyUsage.utility && typeof existingMonthlyUsage.utility === 'object') {
                            existingMonthlyUsage.utility.qty = (existingMonthlyUsage.utility.qty || 0) + (usageData.utility.qty || 0);
                            existingMonthlyUsage.utility.totalCost = (existingMonthlyUsage.utility.totalCost || 0) + (usageData.utility.totalCost || 0);
                        } else {
                            existingMonthlyUsage.utility = { qty: (existingMonthlyUsage.utility || 0) + (usageData.utility.qty || 0), totalCost: (usageData.utility.totalCost || 0) };
                        }
                        if (existingMonthlyUsage.freeUtility && typeof existingMonthlyUsage.freeUtility === 'object') {
                            existingMonthlyUsage.freeUtility.qty = (existingMonthlyUsage.freeUtility.qty || 0) + (usageData.freeUtility.qty || 0);
                            existingMonthlyUsage.freeUtility.totalCost = (existingMonthlyUsage.freeUtility.totalCost || 0) + (usageData.freeUtility.totalCost || 0);
                        } else {
                            existingMonthlyUsage.freeUtility = { qty: (existingMonthlyUsage.freeUtility || 0) + (usageData.freeUtility.qty || 0), totalCost: (usageData.freeUtility.totalCost || 0) };
                        }

                        if (existingMonthlyUsage.authentication && typeof existingMonthlyUsage.authentication === 'object') {
                            existingMonthlyUsage.authentication.qty = (existingMonthlyUsage.authentication.qty || 0) + (usageData.authentication.qty || 0);
                            existingMonthlyUsage.authentication.totalCost = (existingMonthlyUsage.authentication.totalCost || 0) + (usageData.authentication.totalCost || 0);
                        } else {
                            existingMonthlyUsage.authentication = { qty: (existingMonthlyUsage.authentication || 0) + (usageData.authentication.qty || 0), totalCost: (usageData.authentication.totalCost || 0) };
                        }
                        if (existingMonthlyUsage.freeAuthentication && typeof existingMonthlyUsage.freeAuthentication === 'object') {
                            existingMonthlyUsage.freeAuthentication.qty = (existingMonthlyUsage.freeAuthentication.qty || 0) + (usageData.freeAuthentication.qty || 0);
                            existingMonthlyUsage.freeAuthentication.totalCost = (existingMonthlyUsage.freeAuthentication.totalCost || 0) + (usageData.freeAuthentication.totalCost || 0);
                        } else {
                            existingMonthlyUsage.freeAuthentication = { qty: (existingMonthlyUsage.freeAuthentication || 0) + (usageData.freeAuthentication.qty || 0), totalCost: (usageData.freeAuthentication.totalCost || 0) };
                        }

                        if (existingMonthlyUsage.freeService && typeof existingMonthlyUsage.freeService === 'object') {
                            existingMonthlyUsage.freeService.qty = (existingMonthlyUsage.freeService.qty || 0) + (usageData.freeService.qty || 0);
                            existingMonthlyUsage.freeService.totalCost = (existingMonthlyUsage.freeService.totalCost || 0) + (usageData.freeService.totalCost || 0);
                        } else {
                            existingMonthlyUsage.freeService = { qty: (existingMonthlyUsage.freeService || 0) + (usageData.freeService.qty || 0), totalCost: (usageData.freeService.totalCost || 0) };
                        }

                        existingMonthlyUsage.conversation_count += usageData.conversation_count;
                        existingMonthlyUsage.message_count += usageData.message_count;
                        existingMonthlyUsage.total_cost = (existingMonthlyUsage.total_cost || 0) + usageData.total_cost;

                        // Handle users, channels, branches
                        if (usageData.users && typeof usageData.users === 'object') {
                            existingMonthlyUsage.users = (existingMonthlyUsage.users || 0) + (usageData.users.qty || 0);
                        } else {
                            existingMonthlyUsage.users = (existingMonthlyUsage.users || 0) + (usageData.users || 0);
                        }

                        if (usageData.channels && typeof usageData.channels === 'object') {
                            existingMonthlyUsage.channels = (existingMonthlyUsage.channels || 0) + (usageData.channels.qty || 0);
                        } else {
                            existingMonthlyUsage.channels = (existingMonthlyUsage.channels || 0) + (usageData.channels || 0);
                        }

                        if (usageData.branches && typeof usageData.branches === 'object') {
                            existingMonthlyUsage.branches = (existingMonthlyUsage.branches || 0) + (usageData.branches.qty || 0);
                        } else {
                            existingMonthlyUsage.branches = (existingMonthlyUsage.branches || 0) + (usageData.branches || 0);
                        }

                        // Update country-wise data
                        if (usageData.country_wise_data) {
                            if (!existingMonthlyUsage.country_wise_data) {
                                existingMonthlyUsage.country_wise_data = {};
                            }

                            Object.keys(usageData.country_wise_data).forEach(country => {
                                if (!existingMonthlyUsage.country_wise_data[country]) {
                                    existingMonthlyUsage.country_wise_data[country] = {
                                        marketing: { qty: 0, totalCost: 0 },
                                        freeMarketing: { qty: 0, totalCost: 0 },
                                        utility: { qty: 0, totalCost: 0 },
                                        freeUtility: { qty: 0, totalCost: 0 },
                                        authentication: { qty: 0, totalCost: 0 },
                                        freeAuthentication: { qty: 0, totalCost: 0 },
                                        freeService: { qty: 0, totalCost: 0 },
                                        total_conversations: 0,
                                        total_cost: 0
                                    };
                                }

                                const countryData = usageData.country_wise_data[country];
                                Object.keys(countryData).forEach(category => {
                                    if (category === 'total_conversations' || category === 'total_cost') {
                                        existingMonthlyUsage.country_wise_data[country][category] += countryData[category] || 0;
                                    } else if (countryData[category] && typeof countryData[category] === 'object') {
                                        existingMonthlyUsage.country_wise_data[country][category].qty += countryData[category].qty || 0;
                                        existingMonthlyUsage.country_wise_data[country][category].totalCost += countryData[category].totalCost || 0;
                                    }
                                });
                            });
                        }

                        await existingMonthlyUsage.save();
                    } else {
                        // Create new monthly record
                        const monthlyData = {
                            org_id,
                            channel_id,
                            bsp,
                            month,
                            year,
                            conversation_count: usageData.conversation_count,
                            message_count: usageData.message_count,
                            total_cost: usageData.total_cost,
                            country_wise_data: usageData.country_wise_data
                        };

                        // Handle new structure with qty and totalCost
                        if (usageData.marketing && typeof usageData.marketing === 'object') {
                            monthlyData.marketing = usageData.marketing;
                        } else {
                            monthlyData.marketing = { qty: usageData.marketing || 0, totalCost: 0 };
                        }
                        if (usageData.freeMarketing && typeof usageData.freeMarketing === 'object') {
                            monthlyData.freeMarketing = usageData.freeMarketing;
                        } else {
                            monthlyData.freeMarketing = { qty: usageData.freeMarketing || 0, totalCost: 0 };
                        }

                        if (usageData.utility && typeof usageData.utility === 'object') {
                            monthlyData.utility = usageData.utility;
                        } else {
                            monthlyData.utility = { qty: usageData.utility || 0, totalCost: 0 };
                        }
                        if (usageData.freeUtility && typeof usageData.freeUtility === 'object') {
                            monthlyData.freeUtility = usageData.freeUtility;
                        } else {
                            monthlyData.freeUtility = { qty: usageData.freeUtility || 0, totalCost: 0 };
                        }

                        if (usageData.authentication && typeof usageData.authentication === 'object') {
                            monthlyData.authentication = usageData.authentication;
                        } else {
                            monthlyData.authentication = { qty: usageData.authentication || 0, totalCost: 0 };
                        }
                        if (usageData.freeAuthentication && typeof usageData.freeAuthentication === 'object') {
                            monthlyData.freeAuthentication = usageData.freeAuthentication;
                        } else {
                            monthlyData.freeAuthentication = { qty: usageData.freeAuthentication || 0, totalCost: 0 };
                        }

                        if (usageData.freeService && typeof usageData.freeService === 'object') {
                            monthlyData.freeService = usageData.freeService;
                        } else {
                            monthlyData.freeService = { qty: usageData.freeService || 0, totalCost: 0 };
                        }

                        // Handle users, channels, branches
                        if (usageData.users && typeof usageData.users === 'object') {
                            monthlyData.users = usageData.users.qty;
                        } else {
                            monthlyData.users = usageData.users;
                        }

                        if (usageData.channels && typeof usageData.channels === 'object') {
                            monthlyData.channels = usageData.channels.qty;
                        } else {
                            monthlyData.channels = usageData.channels;
                        }

                        if (usageData.branches && typeof usageData.branches === 'object') {
                            monthlyData.branches = usageData.branches.qty;
                        } else {
                            monthlyData.branches = usageData.branches;
                        }

                        await MonthlyUsage.create(monthlyData);
                    }

                    return { success: true, message: "Monthly usage updated successfully" };
                } catch (error) {
                    this.logger.error("Error updating monthly usage:", error.message);
                    throw new MoleculerError("Failed to update monthly usage", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Get daily usage for a specific month
         */
        getDailyUsageByMonth: {
            auth: "required",
            params: {
                month: { type: "string", required: true },
                year: { type: "string", required: true },
                bsp_type: { type: "string", optional: true, enum: ["gupshup", "interakt"] } // Optional: filter by BSP type
            },
            async handler(ctx) {
                const { month, year, bsp_type } = ctx.params;
                const org_id = ctx.meta.org_id; // Get org_id from meta

                try {
                    // Calculate date range for the month
                    const startDate = new Date(year, month - 1, 1); // Month is 0-indexed in JS
                    const endDate = new Date(year, month, 0); // Last day of the month

                    // Build query
                    const query = {
                        date: {
                            $gte: startDate,
                            $lte: endDate
                        }
                    };

                    // Add optional filters
                    if (org_id) {
                        query.org_id = org_id;
                    }

                    if (bsp_type) {
                        query.bsp_type = bsp_type;
                    }

                    // Fetch daily usage data
                    const dailyUsage = await this.adapter.model.find(query)
                        .sort({ date: 1, org_id: 1, bsp_type: 1 })
                        .lean();

                    // Create daily usage array for UI table
                    const dailyUsageArray = [];
                    const monthDays = new Date(year, month, 0).getDate(); // Get number of days in month

                    for (let day = 1; day <= monthDays; day++) {
                        const currentDate = new Date(year, month - 1, day);
                        const dateKey = currentDate.toISOString().split('T')[0];

                        // Find usage data for this date
                        const dayUsage = dailyUsage.filter(usage => {
                            const usageDate = new Date(usage.date);
                            return usageDate.getDate() === day &&
                                usageDate.getMonth() === month - 1 &&
                                usageDate.getFullYear() === year;
                        });

                        // Aggregate data for this day across all channels/BSPs
                        const aggregatedUsage = {
                            date: currentDate,
                            marketing: { qty: 0, totalCost: 0 },
                            freeMarketing: { qty: 0, totalCost: 0 },
                            utility: { qty: 0, totalCost: 0 },
                            freeUtility: { qty: 0, totalCost: 0 },
                            authentication: { qty: 0, totalCost: 0 },
                            freeAuthentication: { qty: 0, totalCost: 0 },
                            freeService: { qty: 0, totalCost: 0 }, // Only freeService
                            users: { qty: 0, totalCost: 0 },
                            channels: { qty: 0, totalCost: 0 },
                            branches: { qty: 0, totalCost: 0 },
                            total_cost: 0,
                            country_wise_data: {}
                        };

                        dayUsage.forEach(usage => {
                            // Handle new structure with qty and totalCost for all fields
                            if (usage.marketing && typeof usage.marketing === 'object') {
                                aggregatedUsage.marketing.qty += usage.marketing.qty || 0;
                                aggregatedUsage.marketing.totalCost += usage.marketing.totalCost || 0;
                            } else {
                                aggregatedUsage.marketing.qty += usage.marketing || 0;
                                aggregatedUsage.marketing.totalCost += 0;
                            }
                            if (usage.freeMarketing && typeof usage.freeMarketing === 'object') {
                                aggregatedUsage.freeMarketing.qty += usage.freeMarketing.qty || 0;
                                aggregatedUsage.freeMarketing.totalCost += usage.freeMarketing.totalCost || 0;
                            } else {
                                aggregatedUsage.freeMarketing.qty += usage.freeMarketing || 0;
                                aggregatedUsage.freeMarketing.totalCost += 0;
                            }

                            if (usage.utility && typeof usage.utility === 'object') {
                                aggregatedUsage.utility.qty += usage.utility.qty || 0;
                                aggregatedUsage.utility.totalCost += usage.utility.totalCost || 0;
                            } else {
                                aggregatedUsage.utility.qty += usage.utility || 0;
                                aggregatedUsage.utility.totalCost += 0;
                            }
                            if (usage.freeUtility && typeof usage.freeUtility === 'object') {
                                aggregatedUsage.freeUtility.qty += usage.freeUtility.qty || 0;
                                aggregatedUsage.freeUtility.totalCost += usage.freeUtility.totalCost || 0;
                            } else {
                                aggregatedUsage.freeUtility.qty += usage.freeUtility || 0;
                                aggregatedUsage.freeUtility.totalCost += 0;
                            }

                            if (usage.authentication && typeof usage.authentication === 'object') {
                                aggregatedUsage.authentication.qty += usage.authentication.qty || 0;
                                aggregatedUsage.authentication.totalCost += usage.authentication.totalCost || 0;
                            } else {
                                aggregatedUsage.authentication.qty += usage.authentication || 0;
                                aggregatedUsage.authentication.totalCost += 0;
                            }
                            if (usage.freeAuthentication && typeof usage.freeAuthentication === 'object') {
                                aggregatedUsage.freeAuthentication.qty += usage.freeAuthentication.qty || 0;
                                aggregatedUsage.freeAuthentication.totalCost += usage.freeAuthentication.totalCost || 0;
                            } else {
                                aggregatedUsage.freeAuthentication.qty += usage.freeAuthentication || 0;
                                aggregatedUsage.freeAuthentication.totalCost += 0;
                            }

                            if (usage.freeService && typeof usage.freeService === 'object') { // Only freeService
                                aggregatedUsage.freeService.qty += usage.freeService.qty || 0;
                                aggregatedUsage.freeService.totalCost += usage.freeService.totalCost || 0;
                            } else {
                                aggregatedUsage.freeService.qty += usage.freeService || 0;
                                aggregatedUsage.freeService.totalCost += 0;
                            }

                            // Handle users, channels, branches with same structure
                            if (usage.users && typeof usage.users === 'object') {
                                aggregatedUsage.users.qty += usage.users.qty || 0;
                                aggregatedUsage.users.totalCost += usage.users.totalCost || 0;
                            } else {
                                aggregatedUsage.users.qty += usage.users || 0;
                                aggregatedUsage.users.totalCost += 0;
                            }

                            if (usage.channels && typeof usage.channels === 'object') {
                                aggregatedUsage.channels.qty += usage.channels.qty || 0;
                                aggregatedUsage.channels.totalCost += usage.channels.totalCost || 0;
                            } else {
                                aggregatedUsage.channels.qty += usage.channels || 0;
                                aggregatedUsage.channels.totalCost += 0;
                            }

                            if (usage.branches && typeof usage.branches === 'object') {
                                aggregatedUsage.branches.qty += usage.branches.qty || 0;
                                aggregatedUsage.branches.totalCost += usage.branches.totalCost || 0;
                            } else {
                                aggregatedUsage.branches.qty += usage.branches || 0;
                                aggregatedUsage.branches.totalCost += 0;
                            }

                            aggregatedUsage.total_cost += usage.total_cost || 0;

                            // Merge country-wise data
                            if (usage.country_wise_data) {
                                Object.keys(usage.country_wise_data).forEach(country => {
                                    if (!aggregatedUsage.country_wise_data[country]) {
                                        aggregatedUsage.country_wise_data[country] = {
                                            marketing: { qty: 0, totalCost: 0 },
                                            freeMarketing: { qty: 0, totalCost: 0 },
                                            utility: { qty: 0, totalCost: 0 },
                                            freeUtility: { qty: 0, totalCost: 0 },
                                            authentication: { qty: 0, totalCost: 0 },
                                            freeAuthentication: { qty: 0, totalCost: 0 },
                                            freeService: { qty: 0, totalCost: 0 },
                                            total_conversations: 0,
                                            total_cost: 0
                                        };
                                    }

                                    const countryData = usage.country_wise_data[country];
                                    Object.keys(countryData).forEach(category => {
                                        if (category === 'total_conversations' || category === 'total_cost') {
                                            aggregatedUsage.country_wise_data[country][category] += countryData[category] || 0;
                                        } else if (countryData[category] && typeof countryData[category] === 'object') {
                                            aggregatedUsage.country_wise_data[country][category].qty += countryData[category].qty || 0;
                                            aggregatedUsage.country_wise_data[country][category].totalCost += countryData[category].totalCost || 0;
                                        }
                                    });
                                });
                            }
                        });

                        dailyUsageArray.push(aggregatedUsage);
                    }

                    // Calculate monthly totals
                    const monthlyTotals = {
                        marketing: { qty: 0, totalCost: 0 },
                        freeMarketing: { qty: 0, totalCost: 0 },
                        utility: { qty: 0, totalCost: 0 },
                        freeUtility: { qty: 0, totalCost: 0 },
                        authentication: { qty: 0, totalCost: 0 },
                        freeAuthentication: { qty: 0, totalCost: 0 },
                        freeService: { qty: 0, totalCost: 0 }, // Only freeService
                        users: { qty: 0, totalCost: 0 },
                        channels: { qty: 0, totalCost: 0 },
                        branches: { qty: 0, totalCost: 0 },
                        total_cost: 0
                    };

                    dailyUsageArray.forEach(day => {
                        monthlyTotals.marketing.qty += day.marketing.qty;
                        monthlyTotals.marketing.totalCost += day.marketing.totalCost;
                        monthlyTotals.freeMarketing.qty += day.freeMarketing.qty;
                        monthlyTotals.freeMarketing.totalCost += day.freeMarketing.totalCost;
                        monthlyTotals.utility.qty += day.utility.qty;
                        monthlyTotals.utility.totalCost += day.utility.totalCost;
                        monthlyTotals.freeUtility.qty += day.freeUtility.qty;
                        monthlyTotals.freeUtility.totalCost += day.freeUtility.totalCost;
                        monthlyTotals.authentication.qty += day.authentication.qty;
                        monthlyTotals.authentication.totalCost += day.authentication.totalCost;
                        monthlyTotals.freeAuthentication.qty += day.freeAuthentication.qty;
                        monthlyTotals.freeAuthentication.totalCost += day.freeAuthentication.totalCost;
                        monthlyTotals.freeService.qty += day.freeService.qty; // Only freeService
                        monthlyTotals.freeService.totalCost += day.freeService.totalCost;
                        monthlyTotals.users.qty += day.users.qty;
                        monthlyTotals.users.totalCost += day.users.totalCost;
                        monthlyTotals.channels.qty += day.channels.qty;
                        monthlyTotals.channels.totalCost += day.channels.totalCost;
                        monthlyTotals.branches.qty += day.branches.qty;
                        monthlyTotals.branches.totalCost += day.branches.totalCost;
                        monthlyTotals.total_cost += day.total_cost;
                    });

                    return {
                        success: true,
                        message: `Daily usage for ${month}/${year}`,
                        data: {
                            month,
                            year,
                            dateRange: {
                                start: startDate,
                                end: endDate
                            },
                            dailyUsage: dailyUsageArray, // Array format for UI table
                            monthlyTotals,
                            totalDays: monthDays,
                            totalRecords: dailyUsage.length
                        }
                    };

                } catch (error) {
                    this.logger.error("Error fetching daily usage by month:", error);
                    throw new MoleculerError(
                        `Failed to fetch daily usage for ${month}/${year}: ${error.message}`,
                        500,
                        "INTERNAL_SERVER_ERROR"
                    );
                }
            }
        },

        /**
         * Get daily usage summary for a specific month (aggregated view)
         */
        getDailyUsageSummary: {
            auth: "required",
            params: {
                month: { type: "number", required: true, min: 1, max: 12 },
                year: { type: "number", required: true, min: 2020 }
            },
            async handler(ctx) {
                const { month, year } = ctx.params;
                const org_id = ctx.meta.org_id; // Get org_id from meta

                try {
                    // Calculate date range for the month
                    const startDate = new Date(year, month - 1, 1);
                    const endDate = new Date(year, month, 0);

                    // Build aggregation pipeline
                    const pipeline = [
                        {
                            $match: {
                                date: {
                                    $gte: startDate,
                                    $lte: endDate
                                }
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                                    org_id: "$org_id",
                                    bsp_type: "$bsp_type"
                                },
                                marketing: { $sum: "$marketing.qty" },
                                freeMarketing: { $sum: "$freeMarketing.qty" },
                                utility: { $sum: "$utility.qty" },
                                freeUtility: { $sum: "$freeUtility.qty" },
                                authentication: { $sum: "$authentication.qty" },
                                freeAuthentication: { $sum: "$freeAuthentication.qty" },
                                freeService: { $sum: "$freeService.qty" },
                                total_messages: { $sum: "$message_count" },
                                total_conversations: { $sum: "$conversation_count" },
                                total_cost: { $sum: "$total_cost" }
                            }
                        },
                        {
                            $sort: { "_id.date": 1, "_id.org_id": 1 }
                        }
                    ];

                    // Add org filter if provided
                    if (org_id) {
                        pipeline[0].$match.org_id = org_id;
                    }

                    const summary = await this.adapter.model.aggregate(pipeline);

                    return {
                        success: true,
                        message: `Daily usage summary for ${month}/${year}`,
                        data: {
                            month,
                            year,
                            dateRange: {
                                start: startDate,
                                end: endDate
                            },
                            summary,
                            totalDays: summary.length,
                            totalRecords: summary.length
                        }
                    };

                } catch (error) {
                    this.logger.error("Error fetching daily usage summary:", error);
                    throw new MoleculerError(
                        `Failed to fetch daily usage summary for ${month}/${year}: ${error.message}`,
                        500,
                        "INTERNAL_SERVER_ERROR"
                    );
                }
            }
        },

        /**
         * Get monthly usage history for a specific organisation
         */
        getMonthlyUsageHistory: {
            auth: "required",
            validator: true,
            params: {
                months: { type: "number", integer: true, convert: true, min: 1, default: 6 } // Number of months to fetch history for
            },
            async handler(ctx) {
                const { months } = ctx.params;
                const org_id = ctx.meta.org_id; // Get org_id from meta

                try {
                    const today = new Date();
                    const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); // Last day of current month
                    const startDate = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1); // First day of 'months' ago

                    const MonthlyUsage = require("../../models/billing/monthy_account_usgae.model");

                    const monthlyUsageData = await MonthlyUsage.find({
                        org_id,
                        year: { $gte: startDate.getFullYear() },
                        $or: [
                            { year: startDate.getFullYear(), month: { $gte: startDate.getMonth() + 1 } },
                            { year: { $gt: startDate.getFullYear() } }
                        ]
                    })
                        .sort({ year: 1, month: 1 })
                        .lean();

                    // Filter data to ensure it's within the exact month range
                    const filteredData = monthlyUsageData.filter(data => {
                        const dataDate = new Date(data.year, data.month - 1, 1);
                        return dataDate >= new Date(startDate.getFullYear(), startDate.getMonth(), 1) &&
                            dataDate <= new Date(endDate.getFullYear(), endDate.getMonth(), 1);
                    });

                    const categories = ['Marketing', 'FreeMarketing', 'Utility', 'FreeUtility', 'Authentication', 'FreeAuthentication', 'FreeService', 'Users', 'Channels', 'Branches'];
                    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    const resultData = [];

                    for (let i = 0; i < months; i++) {
                        const currentMonth = new Date(today.getFullYear(), today.getMonth() - (months - 1 - i), 1);
                        const monthYearString = `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

                        categories.forEach(category => {
                            const foundData = filteredData.find(d =>
                                d.month === (currentMonth.getMonth() + 1) &&
                                d.year === currentMonth.getFullYear()
                            );

                            let value = 0;
                            if (foundData) {
                                const lowerCaseCategory = category.toLowerCase();
                                if (foundData[lowerCaseCategory] && typeof foundData[lowerCaseCategory] === 'object') {
                                    value = foundData[lowerCaseCategory].qty || 0;
                                } else {
                                    value = foundData[lowerCaseCategory] || 0;
                                }
                            }

                            resultData.push({
                                month: monthYearString,
                                category: category,
                                value: value
                            });
                        });
                    }

                    return {
                        success: true,
                        message: `Monthly usage history for last ${months} months`,
                        data: resultData
                    };

                } catch (error) {
                    this.logger.error("Error fetching monthly usage history:", error);
                    throw new MoleculerError(
                        `Failed to fetch monthly usage history: ${error.message}`,
                        500,
                        "INTERNAL_SERVER_ERROR"
                    );
                }
            }
        }
    },

    methods: {
        /**
         * Extract usage data from analytics response
         */
        extractUsageFromAnalytics(analyticsData, bsp) {
            let usage = {
                marketing: { qty: 0, totalCost: 0 },
                freeMarketing: { qty: 0, totalCost: 0 },
                utility: { qty: 0, totalCost: 0 },
                freeUtility: { qty: 0, totalCost: 0 },
                authentication: { qty: 0, totalCost: 0 },
                freeAuthentication: { qty: 0, totalCost: 0 },
                freeService: { qty: 0, totalCost: 0 },
                users: { qty: 0, totalCost: 0 },
                channels: { qty: 0, totalCost: 0 },
                branches: { qty: 0, totalCost: 0 },
                conversation_count: 0,
                message_count: 0,
                total_cost: 0,
                country_wise_data: {}
            };

            try {
                if (bsp === "gupshup") {
                    // Parse Gupshup analytics format
                    if (analyticsData.partnerAppUsageList && Array.isArray(analyticsData.partnerAppUsageList)) {
                        analyticsData.partnerAppUsageList.forEach(appUsage => {
                            // Aggregate by conversation categories
                            usage.marketing.qty += appUsage.marketing || 0;
                            usage.marketing.totalCost += 0; // Gupshup doesn't provide per-category cost
                            usage.utility.qty += appUsage.utility || 0;
                            usage.utility.totalCost += 0;
                            usage.authentication.qty += appUsage.authentication || 0;
                            usage.authentication.totalCost += 0;

                            // Gupshup provides 'freeUtility' directly
                            usage.freeUtility.qty += appUsage.freeUtility || 0;
                            usage.freeUtility.totalCost += 0;

                            // Assuming other free categories are not explicitly provided by Gupshup
                            usage.freeMarketing.qty += 0;
                            usage.freeMarketing.totalCost += 0;
                            usage.freeAuthentication.qty += 0;
                            usage.freeAuthentication.totalCost += 0;
                            usage.freeService.qty += appUsage.service || 0; // Map Gupshup's 'service' to 'freeService'
                            usage.freeService.totalCost += 0;

                            // Aggregate total messages and costs
                            usage.conversation_count += appUsage.totalMsg || 0;
                            usage.message_count += appUsage.totalMsg || 0;
                            usage.total_cost += appUsage.totalFees || 0;

                            // Handle users, channels, branches (if available in Gupshup data)
                            usage.users.qty += 0;
                            usage.users.totalCost += 0;
                            usage.channels.qty += 1;
                            usage.channels.totalCost += 0;
                            usage.branches.qty += 0;
                            usage.branches.totalCost += 0;

                            // Store country-wise data (Gupshup doesn't provide country info in this format)
                            const country = "UNKNOWN";
                            if (!usage.country_wise_data[country]) {
                                usage.country_wise_data[country] = {
                                    marketing: { qty: 0, totalCost: 0 },
                                    freeMarketing: { qty: 0, totalCost: 0 },
                                    utility: { qty: 0, totalCost: 0 },
                                    freeUtility: { qty: 0, totalCost: 0 },
                                    authentication: { qty: 0, totalCost: 0 },
                                    freeAuthentication: { qty: 0, totalCost: 0 },
                                    freeService: { qty: 0, totalCost: 0 },
                                    total_conversations: 0,
                                    total_cost: 0
                                };
                            }

                            usage.country_wise_data[country].marketing.qty += appUsage.marketing || 0;
                            usage.country_wise_data[country].utility.qty += appUsage.utility || 0;
                            usage.country_wise_data[country].authentication.qty += appUsage.authentication || 0;
                            usage.country_wise_data[country].freeUtility.qty += appUsage.freeUtility || 0;
                            usage.country_wise_data[country].freeService.qty += appUsage.service || 0; // Map Gupshup's 'service' to 'freeService'
                            usage.country_wise_data[country].total_conversations += appUsage.totalMsg || 0;
                            usage.country_wise_data[country].total_cost += appUsage.totalFees || 0;
                        });
                    }
                } else if (bsp === "interakt") {
                    // Parse Interakt analytics format
                    if (analyticsData.pricing_analytics && analyticsData.pricing_analytics.data) {
                        analyticsData.pricing_analytics.data.forEach(item => {
                            if (item.data_points && Array.isArray(item.data_points)) {
                                item.data_points.forEach(dataPoint => {
                                    const category = dataPoint.pricing_category?.toLowerCase() || "unknown";
                                    const pricingType = dataPoint.pricing_type?.toLowerCase() || "unknown";
                                    const country = dataPoint.country || "UNKNOWN";
                                    const cost = dataPoint.cost || 0;
                                    const volume = dataPoint.volume || 0;

                                    // Aggregate by conversation category
                                    if (pricingType === "free_customer_service") {
                                        // These are free messages, categorize them specifically
                                        switch (category) {
                                            case "marketing":
                                                usage.freeMarketing.qty += volume;
                                                usage.freeMarketing.totalCost += cost;
                                                break;
                                            case "utility":
                                                usage.freeUtility.qty += volume;
                                                usage.freeUtility.totalCost += cost;
                                                break;
                                            case "authentication":
                                                usage.freeAuthentication.qty += volume;
                                                usage.freeAuthentication.totalCost += cost;
                                                break;
                                            case "service":
                                                usage.freeService.qty += volume; // Map Interakt's 'service' to 'freeService'
                                                usage.freeService.totalCost += cost;
                                                break;
                                        }
                                    } else {
                                        // These are billable messages
                                        switch (category) {
                                            case "marketing":
                                                usage.marketing.qty += volume;
                                                usage.marketing.totalCost += cost;
                                                break;
                                            case "utility":
                                                usage.utility.qty += volume;
                                                usage.utility.totalCost += cost;
                                                break;
                                            case "authentication":
                                                usage.authentication.qty += volume;
                                                usage.authentication.totalCost += cost;
                                                break;
                                            case "service":
                                                // Service messages are always free, so they should not be here.
                                                // If they appear here, it means they are not free, which contradicts the rule.
                                                // For now, we'll add them to freeService as a fallback.
                                                usage.freeService.qty += volume;
                                                usage.freeService.totalCost += cost;
                                                break;
                                        }
                                    }

                                    // Aggregate total conversations and costs
                                    usage.conversation_count += volume;
                                    usage.total_cost += cost;

                                    // Handle users, channels, branches (if available in Interakt data)
                                    usage.users.qty += 0;
                                    usage.users.totalCost += 0;
                                    usage.channels.qty += 1;
                                    usage.channels.totalCost += 0;
                                    usage.branches.qty += 0;
                                    usage.branches.totalCost += 0;

                                    // Store country-wise data
                                    if (!usage.country_wise_data[country]) {
                                        usage.country_wise_data[country] = {
                                            marketing: { qty: 0, totalCost: 0 },
                                            freeMarketing: { qty: 0, totalCost: 0 },
                                            utility: { qty: 0, totalCost: 0 },
                                            freeUtility: { qty: 0, totalCost: 0 },
                                            authentication: { qty: 0, totalCost: 0 },
                                            freeAuthentication: { qty: 0, totalCost: 0 },
                                            freeService: { qty: 0, totalCost: 0 },
                                            total_conversations: 0,
                                            total_cost: 0
                                        };
                                    }

                                    if (pricingType === "free_customer_service") {
                                        switch (category) {
                                            case "marketing":
                                                usage.country_wise_data[country].freeMarketing.qty += volume;
                                                usage.country_wise_data[country].freeMarketing.totalCost += cost;
                                                break;
                                            case "utility":
                                                usage.country_wise_data[country].freeUtility.qty += volume;
                                                usage.country_wise_data[country].freeUtility.totalCost += cost;
                                                break;
                                            case "authentication":
                                                usage.country_wise_data[country].freeAuthentication.qty += volume;
                                                usage.country_wise_data[country].freeAuthentication.totalCost += cost;
                                                break;
                                            case "service":
                                                usage.country_wise_data[country].freeService.qty += volume; // Map Interakt's 'service' to 'freeService'
                                                usage.country_wise_data[country].freeService.totalCost += cost;
                                                break;
                                        }
                                    } else {
                                        if (category === 'marketing' || category === 'utility' || category === 'authentication') {
                                            usage.country_wise_data[country][category].qty += volume;
                                            usage.country_wise_data[country][category].totalCost += cost;
                                        } else if (category === 'service') { // If service appears here, it's a billable service message, which should be free.
                                            usage.country_wise_data[country].freeService.qty += volume;
                                            usage.country_wise_data[country].freeService.totalCost += cost;
                                        }
                                    }
                                    usage.country_wise_data[country].total_conversations += volume;
                                    usage.country_wise_data[country].total_cost += cost;
                                });
                            }
                        });
                    }
                }
            } catch (error) {
                this.logger.error("Error extracting usage data:", error.message);
            }

            return usage;
        }
    }
};
