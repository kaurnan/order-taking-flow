"use strict";

const { MoleculerError } = require("moleculer").Errors;
const dailyUsageQueue = require("../../queues/daily_usage.queue");
const MonthlyUsage = require("../../models/billing/monthy_account_usgae.model");

module.exports = {
    name: "daily_usage_jobs",
    settings: {
        // Service settings
    },
    dependencies: ["ums_organisation", "daily_usage"],
    actions: {
        /**
         * Schedule daily usage job for a specific organisation
         */
        scheduleDailyUsageJob: {
            params: {
                org_id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { org_id } = ctx.params;

                try {
                    // Check if job already exists for this organisation
                    const existingJobs = await dailyUsageQueue.getJobs(['active', 'waiting', 'delayed']);
                    const orgJobExists = existingJobs.some(job =>
                        job.data.org_id === org_id &&
                        job.opts.repeat &&
                        job.opts.repeat.cron === "0 9 * * *"
                    );

                    if (orgJobExists) {
                        this.logger.info(`Daily usage job already exists for organisation: ${org_id}`);
                        return {
                            success: true,
                            message: "Daily usage job already scheduled",
                            org_id
                        };
                    }

                    // Schedule daily job at 9:00 AM for this organisation
                    const job = await dailyUsageQueue.add(
                        `daily-usage-${org_id}`,
                        {
                            org_id,
                            date: new Date().toISOString()
                        },
                        {
                            repeat: {
                                cron: "0 9 * * *", // Every morning at 9:00 AM
                            },
                            jobId: `daily-usage-${org_id}`, // Unique job ID
                            removeOnComplete: false, // Keep completed jobs for tracking
                            removeOnFail: false
                        }
                    );

                    this.logger.info(`Daily usage job scheduled for organisation: ${org_id}, Job ID: ${job.id}`);

                    return {
                        success: true,
                        message: "Daily usage job scheduled successfully",
                        org_id,
                        job_id: job.id
                    };

                } catch (error) {
                    this.logger.error("Error scheduling daily usage job:", error.message);
                    throw new MoleculerError("Failed to schedule daily usage job", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Remove daily usage job for a specific organisation
         */
        removeDailyUsageJob: {
            params: {
                org_id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { org_id } = ctx.params;

                try {
                    // Find and remove the job
                    const existingJobs = await dailyUsageQueue.getJobs(['active', 'waiting', 'delayed']);
                    const orgJob = existingJobs.find(job =>
                        job.data.org_id === org_id &&
                        job.opts.repeat &&
                        job.opts.repeat.cron === "0 9 * * *"
                    );

                    if (!orgJob) {
                        this.logger.info(`No daily usage job found for organisation: ${org_id}`);
                        return {
                            success: true,
                            message: "No daily usage job found",
                            org_id
                        };
                    }

                    // Remove the job
                    await orgJob.remove();

                    this.logger.info(`Daily usage job removed for organisation: ${org_id}`);

                    return {
                        success: true,
                        message: "Daily usage job removed successfully",
                        org_id
                    };

                } catch (error) {
                    this.logger.error("Error removing daily usage job:", error.message);
                    throw new MoleculerError("Failed to remove daily usage job", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Create monthly usage document for an organisation
         */
        createMonthlyUsageDocument: {
            params: {
                org_id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { org_id } = ctx.params;

                try {
                    // Get all channels for the organisation
                    const channels = await ctx.call("channel.getChannelsByOrgId", { org_id });

                    if (!channels || channels.length === 0) {
                        this.logger.info(`No channels found for organisation: ${org_id}`);
                        return {
                            success: true,
                            message: "No channels found, no monthly usage documents created",
                            org_id
                        };
                    }

                    const currentDate = new Date();
                    const month = currentDate.getMonth() + 1;
                    const year = currentDate.getFullYear();

                    let createdDocuments = 0;

                    for (const channel of channels) {
                        try {
                            // Check if monthly usage already exists for this channel and month
                            const existingMonthlyUsage = await MonthlyUsage.findOne({
                                org_id,
                                channel_id: channel._id,
                                bsp: channel.bsp,
                                month,
                                year
                            });

                            if (!existingMonthlyUsage) {
                                // Create new monthly usage document
                                await MonthlyUsage.create({
                                    org_id,
                                    channel_id: channel._id,
                                    bsp: channel.bsp,
                                    month,
                                    year,
                                    marketing: 0,
                                    utility: 0,
                                    authentication: 0,
                                    service: 0,
                                    users: 0,
                                    channels: 0,
                                    branches: 0,
                                    conversation_count: 0,
                                    message_count: 0,
                                    total_cost: 0
                                });

                                createdDocuments++;
                                this.logger.info(`Created monthly usage document for channel ${channel._id} (${channel.bsp})`);
                            }
                        } catch (channelError) {
                            this.logger.error(`Error creating monthly usage for channel ${channel._id}:`, channelError.message);
                            continue;
                        }
                    }

                    return {
                        success: true,
                        message: `Monthly usage documents created successfully`,
                        org_id,
                        created_documents: createdDocuments,
                        month,
                        year
                    };

                } catch (error) {
                    this.logger.error("Error creating monthly usage documents:", error.message);
                    throw new MoleculerError("Failed to create monthly usage documents", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Get all scheduled daily usage jobs
         */
        getScheduledJobs: {
            async handler(ctx) {
                try {
                    const jobs = await dailyUsageQueue.getJobs(['active', 'waiting', 'delayed']);
                    const dailyUsageJobs = jobs.filter(job =>
                        job.opts.repeat &&
                        job.opts.repeat.cron === "0 9 * * *"
                    );

                    const jobDetails = dailyUsageJobs.map(job => ({
                        job_id: job.id,
                        org_id: job.data.org_id,
                        status: job.status,
                        next_run: job.opts.repeat ? job.opts.repeat.nextDate : null,
                        created_at: job.timestamp
                    }));

                    return {
                        success: true,
                        total_jobs: jobDetails.length,
                        jobs: jobDetails
                    };

                } catch (error) {
                    this.logger.error("Error getting scheduled jobs:", error.message);
                    throw new MoleculerError("Failed to get scheduled jobs", 500, "INTERNAL_ERROR");
                }
            }
        },

        /**
         * Manually trigger daily usage processing for an organisation
         */
        triggerDailyUsage: {
            params: {
                org_id: { type: "string", required: true },
                date: { type: "string", optional: true } // ISO date string, defaults to today
            },
            async handler(ctx) {
                const { org_id, date } = ctx.params;
                const targetDate = date || new Date().toISOString();

                try {
                    // Add a one-time job to process daily usage
                    const job = await dailyUsageQueue.add(
                        `manual-daily-usage-${org_id}-${Date.now()}`,
                        {
                            org_id,
                            date: targetDate
                        },
                        {
                            delay: 1000, // 1 second delay
                            removeOnComplete: true,
                            removeOnFail: false
                        }
                    );

                    this.logger.info(`Manual daily usage job triggered for organisation: ${org_id}, Job ID: ${job.id}`);

                    return {
                        success: true,
                        message: "Daily usage processing triggered successfully",
                        org_id,
                        date: targetDate,
                        job_id: job.id
                    };

                } catch (error) {
                    this.logger.error("Error triggering daily usage:", error.message);
                    throw new MoleculerError("Failed to trigger daily usage", 500, "INTERNAL_ERROR");
                }
            }
        }
    },

    events: {
        // Listen for organisation creation events
        "ums_organisation.created": {
            async handler(payload) {
                try {
                    const { _id: org_id } = payload;

                    // Schedule daily usage job for the new organisation
                    await this.broker.call("daily_usage_jobs.scheduleDailyUsageJob", { org_id });

                    // Create monthly usage documents
                    await this.broker.call("daily_usage_jobs.createMonthlyUsageDocument", { org_id });

                    this.logger.info(`Daily usage setup completed for new organisation: ${org_id}`);
                } catch (error) {
                    this.logger.error("Error setting up daily usage for new organisation:", error.message);
                }
            }
        }
    },

    methods: {
        /**
         * Initialize daily usage jobs for existing organisations
         * This method is called during service startup
         */
        async initializeExistingOrganisations() {
            try {
                this.logger.info("Initializing daily usage jobs for existing organisations...");

                // Get all organisations
                const organisations = await this.broker.call("ums_organisation.umsListOrganisations");

                if (!organisations || organisations.length === 0) {
                    this.logger.info("No organisations found");
                    return;
                }

                let scheduledJobs = 0;
                let createdMonthlyDocs = 0;
                for (const org of organisations) {
                    try {
                        // Schedule daily usage job
                        const jobResult = await this.broker.call("daily_usage_jobs.scheduleDailyUsageJob", {
                            org_id: org._id.toString()
                        });

                        if (jobResult.success) {
                            scheduledJobs++;
                        }

                        // Create monthly usage documents
                        const monthlyResult = await this.broker.call("daily_usage_jobs.createMonthlyUsageDocument", {
                            org_id: org._id.toString()
                        });

                        if (monthlyResult.success) {
                            createdMonthlyDocs += monthlyResult.created_documents;
                        }

                    } catch (orgError) {
                        this.logger.error(`Error initializing organisation ${org._id}:`, orgError.message);
                        continue;
                    }
                }

                this.logger.info(`Initialization complete: ${scheduledJobs} jobs scheduled, ${createdMonthlyDocs} monthly documents created`);

            } catch (error) {
                this.logger.error("Error initializing existing organisations:", error.message);
            }
        }
    },

    async started() {
        // Initialize daily usage jobs for existing organisations when service starts
        setTimeout(() => {
            this.initializeExistingOrganisations();
        }, 5000); // Wait 5 seconds for other services to be ready
    }
};
