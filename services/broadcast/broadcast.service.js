const DbMixin = require("../../mixins/db.mixin");
const customerModel = require("../../models/customer.model");
const ListsModel = require("../../models/list.model");
const segmentModel = require("../../models/segment.model");
const walletModel = require("../../models/wallet.model");
const broadcastBatchQueue = require("../../queues/broadcast_batch.queue");
const sendMessageQueue = require("../../queues/send_message.queue");
const BroadcastOverviewModel = require("../../models/broadcast_overview.model");
const { formatQuery } = require("../../utils/common");
const { ObjectId } = require("mongodb");
const { reformatTemplatePayload } = require("../../utils/helpers");
const { MoleculerError } = require("moleculer").Errors;

"use strict";

module.exports = {
    name: "broadcast",
    mixins: [DbMixin("broadcast")],
    actions: {

        /**
         * List all broadcasts with pagination and filtering options
         * @returns {Object} List of broadcasts with pagination info
         */
        listBroadcasts: {
            auth: "required",
            rest: "GET /listBroadcasts",
            params: {
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                search: { type: "string", optional: true },
                status: { type: "string", optional: true, enum: ["draft", "active", "completed", "paused", "cancelled", "failed"] }
            },
            async handler(ctx) {
                const { pageSize, page, search, status } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes && !ctx.meta.scopes.includes("broadcast_read") && !ctx.meta.scopes.includes("broadcast_write") && !ctx.meta.scopes.includes("full_control")) {
                    throw new MoleculerError("You do not have permission to read broadcasts", 403, "FORBIDDEN");
                }
                const query = {
                    org_id: org_id,
                    branch_id: branch_id
                };
                const skip = (parseInt(page) - 1) * parseInt(pageSize);
                if (search) query.title = { $regex: search, $options: "i" };
                if (status) query.status = status;

                const total = await this.adapter.model.countDocuments(query);
                const broadcast = await this.adapter.model.find(query).skip(skip).limit(parseInt(pageSize)).sort({ _id: -1 });

                return {
                    success: true,
                    message: "Broadcast fetched successfully",
                    data: broadcast,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pageSize: parseInt(pageSize),
                        totalPages: Math.ceil(total / parseInt(pageSize)),
                    },
                };
            }
        },

        changeBroadcastStatus: {
            async handler(ctx) {
                const { broadcastId, status } = ctx.params;
                const updatedBroadcast = await this.adapter.model.findByIdAndUpdate(broadcastId, { status }, { new: true });
                if (!updatedBroadcast) throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                return {
                    success: true,
                    message: "Broadcast status updated successfully",
                    data: updatedBroadcast
                };
            }
        },

        /**
         * Create a new broadcast
         * @param {Object} ctx.params - Broadcast details
         */
        createBroadcast: {
            auth: "required",
            rest: "POST /createBroadcast",
            params: {
                id: { type: "string", optional: true }, // Optional ID for updates
                title: "string",
                channel: "string",
                retry: "boolean",
                template: { type: "object" },
                audience_cat: { type: "string", enum: ["list", "segment", "manual"] },
                audience_ref: { type: "array", items: "string" },
                start_date: "string",
                end_date: "string",
                offsetMinutes: { type: "number" },
                delay: { type: "number" }
            },
            async handler(ctx) {
                this.hasBroadcastPermission(ctx, "write");

                const { title, channel, template, audience_cat, audience_ref, start_date, end_date, offsetMinutes, retry, id, delay } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                // const delay = this.getDelayFromLocalTime(start_date, offsetMinutes);
                if (delay < 0) throw new MoleculerError("Scheduled date must be in the future", 400, "INVALID_DATE");

                const { audienceCount, ref } = await this.resolveAudience(ctx, audience_cat, audience_ref, org_id, branch_id);

                // Insert broadcast with appropriate audience reference based on audience_cat
                const broadcastData = {
                    title,
                    start_date,
                    branch_id,
                    org_id,
                    audience_cat,
                    channel,
                    template,
                    offsetMinutes: offsetMinutes,
                    end_date,
                    retry,
                    [`${audience_cat}_ref`]: ref,
                    "stats.total_enqueued": audienceCount,
                    "stats.total_recipients": audienceCount,
                    delay,
                };


                const broadcast = id
                    ? await this.adapter.model.findByIdAndUpdate(id, broadcastData, { new: true, upsert: false })
                    : await this.adapter.insert(broadcastData);

                // Call the timeline service method asynchronously
                this.recordBroadcastTimeline(ctx, "broadcast", broadcast._id.toString(), "The broadcast was successfully created", "created", 'user', 'Broadcast Created');

                // Update the broadcast overview
                this.updateBroadcastOverviewCount(broadcast.branch_id, broadcast.org_id, audienceCount);

                return {
                    code: "200",
                    success: true,
                    message: `Broadcast ${id ? "updated" : "created"} and scheduled successfully`,
                    data: broadcast,
                };
            }
        },

        /**
         * Publish a broadcast and schedule it for processing
         * @param {Object} ctx.params - Broadcast ID
         */
        publishBroadcast: {
            auth: "required",
            rest: "POST /publishBroadcast",
            params: {
                broadcastId: "string",
            },
            async handler(ctx) {
                this.hasBroadcastPermission(ctx, "write");
                await this.isWalletBalanceEnough(ctx.meta.org_id);
                const { broadcastId } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                const broadcast = await this.adapter.model.findById(broadcastId);
                if (!broadcast) throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");

                if (["active", "completed", "cancelled"].includes(broadcast.status)) {
                    throw new MoleculerError("Broadcast is already scheduled or completed", 400, "ALREADY_SCHEDULED");
                }

                // Call the method without await since we don't need to wait for the result
                this.publishBroadcast(ctx, broadcastId, org_id, branch_id);

                return {
                    success: true,
                    message: "Broadcast published and scheduled successfully",
                    data: {
                        broadcastId,
                        status: "scheduled"
                    },
                };
            }
        },

        /**
         * Find a broadcast by ID
         * @param {Object} ctx.params - Broadcast ID
         */
        findById: {
            rest: "GET /:id",
            params: {
                id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes && !ctx.meta.scopes.includes("broadcast_read") && ctx.meta.scopes.includes("broadcast_write") && !ctx.meta.scopes.includes("full_control")) {
                    throw new MoleculerError("You do not have permission to read broadcasts", 403, "FORBIDDEN");
                }
                const broadcast = await this.adapter.model.findById(id).populate({ path: "manual_ref", model: customerModel }).populate({ path: "list_ref", model: ListsModel }).populate({ path: "segment_ref", model: segmentModel });
                if (!broadcast) {
                    throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                }
                return {
                    success: true,
                    message: "Broadcast fetched successfully",
                    data: broadcast,
                };
            }
        },


        /**
         * Pause or resume a broadcast
         * @param {Object} ctx.params - Broadcast ID and action (pause/resume)
         */
        pauseResumeBroadcast: {
            auth: "required",
            rest: "POST /PauseResumeBroadcast",
            params: {
                broadcastId: { type: "string", required: true },
                action: { type: "string", enum: ["pause", "resume"], required: true }
            },
            async handler(ctx) {
                const { broadcastId, action } = ctx.params;
                this.hasBroadcastPermission(ctx, "write");
                // Implement the logic to pause or resume the broadcast
                let broadcast;
                if (action === "pause") {
                    // Pause the broadcast
                    broadcast = await this.adapter.model.findByIdAndUpdate(broadcastId, { status: "paused" }, { new: true });
                    if (!broadcast) {
                        throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                    }
                    this.recordBroadcastTimeline(ctx, "broadcast", broadcast._id.toString(), "The broadcast was successfully paused", "paused", 'user', 'Broadcast Paused');
                } else {
                    // Resume the broadcast
                    broadcast = await this.adapter.model.findByIdAndUpdate(broadcastId, { status: "active" }, { new: true });
                    if (!broadcast) {
                        throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                    }
                    this.recordBroadcastTimeline(ctx, "broadcast", broadcast._id.toString(), "The broadcast was successfully resumed", "resumed", 'user', 'Broadcast Resumed');
                }
                return {
                    data: broadcast,
                    success: true,
                    message: `Broadcast ${action}d successfully`,
                };
            }
        },

        /**
         * Delete a broadcast by ID
         * @param {Object} ctx.params - Broadcast ID
         */
        deleteById: {
            rest: "DELETE /:id",
            auth: "required",
            params: {
                id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes && !ctx.meta.scopes.includes("broadcast_write") && !ctx.meta.scopes.includes("full_control")) {
                    throw new MoleculerError("You do not have permission to delete broadcasts", 403, "FORBIDDEN");
                }
                const broadcast = await this.adapter.model.findByIdAndDelete(id);
                if (!broadcast) {
                    throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                }
                return {
                    success: true,
                    message: "Broadcast deleted successfully",
                    data: broadcast,
                };
            }
        },

        addJob: {
            params: {
                user: 'object'
            },
            async handler(ctx) {
                const { user } = ctx.params;
                await sendMessageQueue.add('send', { user }, {
                    attempts: 3,
                    backoff: {
                        type: 'fixed',
                        delay: 5000
                    }
                });
                return { status: 'queued' };
            }
        },

        /**
         * Update the status of a specific batch in a broadcast
         * @param {Object} ctx.params - Broadcast ID, batch number, and status details
         */
        updateBatchStatus: {
            params: {
                broadcastId: { type: "string", required: true },
                batchNumber: { type: "number", required: true },
                status: { type: "string", required: true, enum: ["scheduled", "in_progress", "completed", "failed"] },
                completedAt: { type: "date", optional: true },
                failedAt: { type: "date", optional: true },
                processedCustomers: { type: "number", optional: true },
                error: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { broadcastId, batchNumber, status, completedAt, failedAt, processedCustomers, error } = ctx.params;

                // Build the update object
                const updateData = {
                    [`jobs.$.status`]: status
                };

                // Add additional fields based on status
                if (status === "completed" && completedAt) {
                    updateData[`jobs.$.completedAt`] = completedAt;
                }
                if (status === "failed" && failedAt) {
                    updateData[`jobs.$.failedAt`] = failedAt;
                }
                if (processedCustomers !== undefined) {
                    updateData[`jobs.$.processedCustomers`] = processedCustomers;
                }
                if (error) {
                    updateData[`jobs.$.error`] = error;
                }

                // Update the specific batch job in the broadcast document
                const updatedBroadcast = await this.adapter.model.findOneAndUpdate(
                    {
                        _id: new ObjectId(broadcastId),
                        "jobs.batchNumber": batchNumber
                    },
                    {
                        $set: updateData
                    },
                    { new: true }
                );

                if (!updatedBroadcast) {
                    throw new MoleculerError("Broadcast or batch not found", 404, "NOT_FOUND");
                }

                // Check if all batches are completed to update overall broadcast status
                if (status === "completed") {
                    await this.checkAndUpdateBroadcastStatus(broadcastId);
                }

                return {
                    success: true,
                    message: `Batch ${batchNumber} status updated to ${status}`,
                    data: updatedBroadcast
                };
            }
        }

    },

    methods: {

        async publishBroadcast(ctx, broadcastId, org_id, branch_id) {
            const broadcast = await this.adapter.model.findById(broadcastId);
            if (!broadcast) {
                throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
            }
            const { title, channel, audience_cat, start_date, offsetMinutes } = broadcast;
            const reformattedTemplate = reformatTemplatePayload(broadcast.template);
            const audience_ref = broadcast[`${audience_cat}_ref`];
            const { audienceCount } = await this.resolveAudience(ctx, audience_cat, audience_ref, org_id, branch_id);
            const delay = broadcast.delay || this.getDelayFromLocalTime(start_date, offsetMinutes);
            console.log(`Delay for Broadcast: ${delay}`);
            if (delay < 0) {
                throw new MoleculerError("Scheduled date must be in the future", 400, "INVALID_DATE");
            }

            // Get channel details to determine messaging limit tier
            const channelDetails = await ctx.call("channel.getChannel", { id: channel.toString() });
            if (!channelDetails.success) {
                throw new MoleculerError("Channel not found", 404, "NOT_FOUND");
            }

            const messagingLimitTier = channelDetails.data?.phone_number_details?.messaging_limit_tier || "TIER_50";
            const batchSize = this.getTierValue(messagingLimitTier);

            console.log(`Channel messaging limit tier: ${messagingLimitTier}, Batch size: ${batchSize}`);
            console.log(`Total audience count: ${audienceCount}`);

            // Calculate number of batches needed
            const numberOfBatches = Math.ceil(audienceCount / batchSize);
            console.log(`Creating ${numberOfBatches} batches`);

            // Create batches and schedule jobs
            const batchJobs = [];
            for (let i = 0; i < numberOfBatches; i++) {
                const startId = i * batchSize;
                const endId = Math.min((i + 1) * batchSize, audienceCount);
                const batchNumber = i + 1;

                // Calculate delay for each batch
                // First batch: immediate (original delay)
                // Subsequent batches: add 24 hours (86400000 ms) for each additional day
                let batchDelay = delay;
                if (i > 0) {
                    const additionalDays = i; // 0 for first batch, 1 for second batch, 2 for third batch, etc.
                    const additionalDelay = additionalDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
                    batchDelay = delay + additionalDelay;

                    console.log(`Batch ${batchNumber}: Scheduled for ${additionalDays + 1} day(s) after the first batch`);
                } else {
                    console.log(`Batch ${batchNumber}: Scheduled for immediate processing`);
                }

                const payload = {
                    broadcastId: broadcast._id,
                    template: reformattedTemplate,
                    org_id,
                    branch_id,
                    title,
                    audience_category: audience_cat,
                    audience_ref,
                    offset: startId,
                    offset_doc_id: null,
                    retry: broadcast.retry,
                    limit: endId - startId,
                    batchNumber: batchNumber,
                    channel,
                    startId: startId,
                    endId: endId,
                    totalBatches: numberOfBatches
                };

                // Add the job to the broadcast batch queue with calculated delay
                const job = await broadcastBatchQueue.add(`batch-${broadcastId}-${batchNumber}`, payload, {
                    delay: batchDelay,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 3000
                    }
                });

                batchJobs.push({
                    id: job.id,
                    name: job.name,
                    queue: job.queue.name,
                    opts: job.opts,
                    timestamp: job.timestamp,
                    status: 'scheduled',
                    batchNumber: batchNumber,
                    startId: startId,
                    endId: endId,
                    customerCount: endId - startId
                });

                console.log(`Scheduled batch ${batchNumber}: customers ${startId} to ${endId} (${endId - startId} customers) for ${new Date(Date.now() + batchDelay).toLocaleString()}`);
            }

            // Save job details on broadcast doc (support multiple jobs)
            const updatedBroadcast = await this.adapter.model.findByIdAndUpdate(broadcastId, {
                status: "active",
                $push: {
                    jobs: { $each: batchJobs }
                }
            }, { new: true });

            // Add a simple timeline entry for job scheduling
            await this.recordBroadcastTimeline(
                ctx,
                "broadcast",
                broadcast._id.toString(),
                `The broadcast was scheduled with ${numberOfBatches} batches. First batch starts ${new Date(broadcast.start_date).toLocaleString()}, subsequent batches will run daily. Total customers: ${audienceCount}, Batch size: ${batchSize}.`,
                "scheduled",
                'system',
                'Broadcast Batches Scheduled'
            );

            console.log(`Broadcast ${broadcastId} scheduled successfully with ${numberOfBatches} batches`);
        },

        /**
         * Record a broadcast timeline event
         * @param {*} ctx 
         * @param {*} type 
         * @param {*} reference 
         * @param {*} details 
         * @param {*} status 
         * @param {*} event_type 
         * @param {*} title 
         */
        async recordBroadcastTimeline(ctx, type, reference, details, status, event_type, title) {
            try {
                await ctx.call("timeline.create", {
                    type,
                    reference,
                    event_type,
                    title,
                    details,
                    status,
                    org_id: ctx.meta.org_id // Use org_id from context
                });
            } catch (error) {
                this.logger.error(`Error recording timeline event for broadcast ${reference}:`, error);
            }
        },

        /**
         * Check if the user has broadcast permission
         * @param {*} ctx 
         * @param {*} type 
         */
        hasBroadcastPermission(ctx, type = "write") {
            const scopes = ctx.meta.scopes || [];
            if (type === "read") {
                if (
                    !scopes.includes("broadcast_read") &&
                    !scopes.includes("broadcast_write") &&
                    !scopes.includes("full_control")
                ) {
                    throw new MoleculerError("You do not have permission to read broadcasts", 403, "FORBIDDEN");
                }
            } else {
                if (
                    !scopes.includes("broadcast_write") &&
                    !scopes.includes("full_control")
                ) {
                    throw new MoleculerError("You do not have permission to perform this action", 403, "FORBIDDEN");
                }
            }
        },

        /**
         * Get the adjusted date based on the offset minutes
         * @param {*} dateStr 
         * @param {*} offsetMinutes 
         * @returns 
         */
        getAdjustedDate(dateStr, offsetMinutes) {
            const date = new Date(dateStr);
            return new Date(date.getTime() - offsetMinutes * 60 * 1000);
        },

        /**
         * Get the delay from the local time
         * @param {*} localTimeStr 
         * @param {*} offsetMinutes 
         * @returns 
         */
        getDelayFromLocalTime(localTimeStr, offsetMinutes) {
            const localTime = new Date(localTimeStr); // e.g., '2025-08-01T16:00:00'
            const utcTargetTime = new Date(localTime.getTime() - offsetMinutes * 60 * 1000 + localTime.getTimezoneOffset() * 60 * 1000);
            const now = new Date(); // Server's current time in UTC
            return utcTargetTime.getTime() - now.getTime();
        },

        /**
         * Resolve the audience for the broadcast
         * @param {*} ctx 
         * @param {*} audience_cat 
         * @param {*} audience_ref 
         * @param {*} org_id 
         * @param {*} branch_id 
         * @returns 
         */
        async resolveAudience(ctx, audience_cat, audience_ref, org_id, branch_id) {
            if (audience_cat === "list") {
                const count = await customerModel.countDocuments({
                    lists: { $in: audience_ref.map(id => new ObjectId(id)) },
                });
                if (count === 0) throw new MoleculerError("No customers found in the provided lists", 404, "NOT_FOUND");
                return { audienceCount: count, ref: audience_ref };
            }

            if (audience_cat === "segment") {
                let matchQuery = { org_id, branch_id };
                for (const segId of audience_ref) {
                    const response = await ctx.call("segment.getSegmentById", { id: segId.toString() });
                    const segment = response.data;
                    if (!segment) throw new MoleculerError(`Segment not found: ${segId}`, 404, "NOT_FOUND");

                    // Parse and flatten nested $AND operators
                    const segmentRules = JSON.parse(segment?.rules);
                    const formattedRules = formatQuery(segmentRules);

                    let segmentCondition = {};

                    // Flatten nested $and operators if they exist
                    if (formattedRules.$and) {
                        const flattenedConditions = [];

                        function flattenAnd(conditions) {
                            for (const condition of conditions) {
                                if (condition.$and) {
                                    flattenAnd(condition.$and);
                                } else {
                                    flattenedConditions.push(condition);
                                }
                            }
                        }

                        flattenAnd(formattedRules.$and);

                        // Merge all conditions into the segment condition
                        for (const condition of flattenedConditions) {
                            Object.assign(segmentCondition, condition);
                        }
                    } else {
                        Object.assign(segmentCondition, formattedRules);
                    }

                    if (!matchQuery.$or) matchQuery.$or = [];
                    matchQuery.$or.push(segmentCondition)
                }
                const count = await ctx.call("customer.Getcount", { query: matchQuery });
                if (count === 0) throw new MoleculerError("No customers found matching the segment rules", 404, "NOT_FOUND");
                return { audienceCount: count, ref: audience_ref };
            }

            if (audience_cat === "manual") {
                if (!audience_ref.length) throw new MoleculerError("No customers provided for manual audience", 404, "NOT_FOUND");
                return { audienceCount: audience_ref.length, ref: audience_ref };
            }

            throw new MoleculerError("Invalid audience category", 400, "BAD_REQUEST");
        },

        /**
         * Check the wallet balance before publishing the broadcast
         * @param {*} ctx 
         * @param {*} org_id 
         * @param {*} broadcastCost 
         */
        async isWalletBalanceEnough(org_id) {
            const wallet = await walletModel.findOne({ org_id: new ObjectId(org_id) });
            if (!wallet) throw new MoleculerError("Wallet not found", 404, "NOT_FOUND");
            if (wallet.balance < wallet.min_balance) throw new MoleculerError("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
            return true;
        },

        /**
         * Update the broadcast overview
         * @param {*} branch_id 
         * @param {*} org_id 
         * @param {*} audienceCount 
         * @returns 
         */
        async updateBroadcastOverviewCount(branch_id, org_id, audienceCount) {
            const overview = await BroadcastOverviewModel.findOneAndUpdate(
                { branch_id: new ObjectId(branch_id), org_id: new ObjectId(org_id) },
                { $inc: { total_recipients: audienceCount } },
                { new: true }
            );
            if (!overview) throw new MoleculerError("Broadcast overview not found", 404, "NOT_FOUND");
            return overview;
        },

        /**
         * Get the batch size based on the messaging limit tier
         * @param {string} tier - The messaging limit tier (e.g., "TIER_50", "TIER_250", "TIER_1K", etc.)
         * @returns {number} The batch size for the given tier
         */
        getTierValue(tier) {
            let tierNumber = 0;
            if (tier === "TIER_50") {
                tierNumber = 50;
            } else if (tier === "TIER_250") {
                tierNumber = 250;
            } else if (tier === "TIER_1K") {
                tierNumber = 1000;
            } else if (tier === "TIER_10K") {
                tierNumber = 10000;
            } else if (tier === "TIER_100K") {
                tierNumber = 100000;
            } else if (tier === "TIER_UNLIMITED") {
                tierNumber = 1000000;
            }
            return tierNumber;
        },

        /**
         * Check if all batches are completed and update broadcast status accordingly
         * @param {string} broadcastId - The broadcast ID to check
         */
        async checkAndUpdateBroadcastStatus(broadcastId) {
            try {
                const broadcast = await this.adapter.model.findById(broadcastId);
                if (!broadcast) {
                    console.error(`Broadcast ${broadcastId} not found for status check`);
                    return;
                }

                const jobs = broadcast.jobs || [];
                if (jobs.length === 0) {
                    console.log(`No jobs found for broadcast ${broadcastId}`);
                    return;
                }

                // Check if all batches are completed
                const allCompleted = jobs.every(job => job.status === "completed");
                const hasFailed = jobs.some(job => job.status === "failed");
                const hasInProgress = jobs.some(job => job.status === "in_progress");

                let newStatus = broadcast.status;

                if (allCompleted) {
                    newStatus = "completed";
                    console.log(`All batches completed for broadcast ${broadcastId}, updating status to completed`);
                } else if (hasFailed && !hasInProgress) {
                    // If there are failed batches and no in-progress batches, mark as failed
                    newStatus = "failed";
                    console.log(`Some batches failed for broadcast ${broadcastId}, updating status to failed`);
                }

                // Update broadcast status if it changed
                if (newStatus !== broadcast.status) {
                    await this.adapter.model.findByIdAndUpdate(broadcastId, {
                        status: newStatus,
                        completed_at: newStatus === "completed" ? new Date() : undefined
                    });

                    // Record timeline event for status change
                    try {
                        await this.recordBroadcastTimeline(
                            null, // No context available in this method
                            "broadcast",
                            broadcastId,
                            `Broadcast status updated to ${newStatus}`,
                            newStatus,
                            'system',
                            `Broadcast ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`
                        );
                    } catch (timelineError) {
                        console.error(`Failed to record timeline event for broadcast ${broadcastId}:`, timelineError);
                    }
                }
            } catch (error) {
                console.error(`Error checking broadcast status for ${broadcastId}:`, error);
            }
        }
    }
};
