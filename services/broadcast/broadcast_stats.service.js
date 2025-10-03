const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const BroadcastOverviewModel = require("../../models/broadcast_overview.model");
const { ObjectId } = require("mongodb");
"use strict";

module.exports = {
    name: "broadcast_stats",
    mixins: [dbMixin("broadcast")],

    actions: {
        /**
         * Update broadcast statistics based on message status
         */
        updateBroadcastStats: {
            params: {
                message_id: "string",
                status: { type: "string", enum: ["sent", "delivered", "read", "failed", "replied"] },
                broadcast_id: { type: "string", optional: true },
                error_details: { type: "object", optional: true }
            },
            async handler(ctx) {
                const { message_id, status, broadcast_id, error_details } = ctx.params;

                try {
                    // First, try to get broadcast_id from the message if not provided
                    let broadcastId = broadcast_id;
                    if (!broadcastId) {
                        const message = await ctx.call("supabase.getDataByMessageId", {
                            table: "messages_moleculer",
                            message_id: message_id
                        });

                        if (message && message.length > 0 && message[0].broadcast_id) {
                            broadcastId = message[0].broadcast_id;
                        } else {
                            // If no broadcast_id found, this is not a broadcast message
                            return {
                                success: false,
                                message: "No broadcast_id found for this message"
                            };
                        }
                    }

                    // Get the broadcast document
                    const broadcast = await this.adapter.findById(broadcastId);
                    if (!broadcast) {
                        throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                    }

                    // Update statistics based on status
                    const updateData = {};
                    const updateDataOverview = {};
                    const stats = broadcast.stats || {};

                    switch (status) {
                        case "sent":
                            updateData["stats.total_sent"] = (stats.total_sent || 0) + 1;
                            updateDataOverview["total_sent"] = (updateDataOverview["total_sent"] || 0) + 1;
                            break;
                        case "delivered":
                            updateData["stats.total_delivered"] = (stats.total_delivered || 0) + 1;
                            updateDataOverview["total_delivered"] = (updateDataOverview["total_delivered"] || 0) + 1;
                            break;
                        case "read":
                            updateData["stats.total_read"] = (stats.total_read || 0) + 1;
                            updateDataOverview["total_read"] = (updateDataOverview["total_read"] || 0) + 1;
                            break;
                        case "failed":
                            updateData["stats.total_failed"] = (stats.total_failed || 0) + 1;
                            updateDataOverview["total_failed"] = (updateDataOverview["total_failed"] || 0) + 1;
                            // If message failed, we might need to decrement sent count
                            // if (stats.total_sent > 0) {
                            //     updateData["stats.total_sent"] = stats.total_sent - 1;
                            //     updateDataOverview["total_sent"] = (updateDataOverview["total_sent"] || 0) - 1;
                            // }
                            break;
                        case "replied":
                            updateData["stats.total_replied"] = (stats.total_replied || 0) + 1;
                            updateDataOverview["total_replied"] = (updateDataOverview["total_replied"] || 0) + 1;
                            break;
                        default:
                            throw new MoleculerError("Invalid status", 400, "BAD_REQUEST");
                    }

                    // Update the broadcast document
                    const updatedBroadcast = await this.adapter.updateById(broadcastId, {
                        $set: updateData
                    });
                    await BroadcastOverviewModel.findOneAndUpdate(
                        { branch_id: new ObjectId(broadcast?.branch_id), org_id: new ObjectId(broadcast?.org_id) },
                        { $inc: updateDataOverview },
                        { new: true }
                    );
                    // Record timeline event for significant status changes
                    // if (status === "failed" || status === "delivered") {
                    //     await this.recordBroadcastTimeline(ctx, broadcastId, status, message_id, error_details);
                    // }

                    return {
                        success: true,
                        message: `Broadcast stats updated for status: ${status}`,
                        data: {
                            broadcast_id: broadcastId,
                            status: status,
                            updated_stats: updateData
                        }
                    };

                } catch (error) {
                    this.logger.error("Error updating broadcast stats:", error);
                    throw error;
                }
            }
        },

        /**
         * Get broadcast statistics by broadcast ID
         */
        getBroadcastStats: {
            params: {
                broadcast_id: "string"
            },
            async handler(ctx) {
                const { broadcast_id } = ctx.params;

                try {
                    const broadcast = await this.adapter.findById(broadcast_id);
                    if (!broadcast) {
                        throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                    }

                    return {
                        success: true,
                        data: {
                            broadcast_id: broadcast_id,
                            stats: broadcast.stats || {},
                            total_enqueued: broadcast.stats?.total_enqueued || 0,
                            total_sent: broadcast.stats?.total_sent || 0,
                            total_delivered: broadcast.stats?.total_delivered || 0,
                            total_read: broadcast.stats?.total_read || 0,
                            total_failed: broadcast.stats?.total_failed || 0,
                            total_clicked: broadcast.stats?.total_clicked || 0,
                            total_replied: broadcast.stats?.total_replied || 0,
                            total_recipients: broadcast.stats?.total_recipients || 0
                        }
                    };

                } catch (error) {
                    this.logger.error("Error getting broadcast stats:", error);
                    throw error;
                }
            }
        },

        /**
         * Bulk update broadcast stats for multiple messages
         */
        bulkUpdateBroadcastStats: {
            params: {
                updates: {
                    type: "array",
                    items: {
                        type: "object",
                        props: {
                            message_id: "string",
                            status: { type: "string", enum: ["sent", "delivered", "read", "failed"] },
                            broadcast_id: { type: "string", optional: true },
                            error_details: { type: "object", optional: true }
                        }
                    }
                }
            },
            async handler(ctx) {
                const { updates } = ctx.params;
                const results = [];

                for (const update of updates) {
                    try {
                        const result = await ctx.call("broadcast_stats.updateBroadcastStats", update);
                        results.push({
                            message_id: update.message_id,
                            success: true,
                            result: result
                        });
                    } catch (error) {
                        results.push({
                            message_id: update.message_id,
                            success: false,
                            error: error.message
                        });
                    }
                }

                return {
                    success: true,
                    message: `Processed ${updates.length} updates`,
                    data: {
                        total_processed: updates.length,
                        successful: results.filter(r => r.success).length,
                        failed: results.filter(r => !r.success).length,
                        results: results
                    }
                };
            }
        },

        /**
         * Reset broadcast statistics
         */
        resetBroadcastStats: {
            params: {
                broadcast_id: "string"
            },
            async handler(ctx) {
                const { broadcast_id } = ctx.params;

                try {
                    const broadcast = await this.adapter.findById(broadcast_id);
                    if (!broadcast) {
                        throw new MoleculerError("Broadcast not found", 404, "NOT_FOUND");
                    }

                    const resetStats = {
                        total_sent: 0,
                        total_delivered: 0,
                        total_read: 0,
                        total_failed: 0,
                        total_clicked: 0,
                        total_replied: 0
                    };

                    const updatedBroadcast = await this.adapter.updateById(broadcast_id, {
                        $set: { stats: resetStats }
                    });

                    await this.recordBroadcastTimeline(ctx, broadcast_id, "stats_reset", null, {
                        reason: "Manual reset",
                        previous_stats: broadcast.stats
                    });

                    return {
                        success: true,
                        message: "Broadcast statistics reset successfully",
                        data: {
                            broadcast_id: broadcast_id,
                            stats: resetStats
                        }
                    };

                } catch (error) {
                    this.logger.error("Error resetting broadcast stats:", error);
                    throw error;
                }
            }
        }
    },

    methods: {
        /**
         * Record timeline event for broadcast status changes
         */
        async recordBroadcastTimeline(ctx, broadcastId, status, messageId, details) {
            try {
                const timelineEvents = {
                    sent: {
                        title: "Message Sent",
                        details: `Message ${messageId} was sent successfully`
                    },
                    delivered: {
                        title: "Message Delivered",
                        details: `Message ${messageId} was delivered to recipient`
                    },
                    read: {
                        title: "Message Read",
                        details: `Message ${messageId} was read by recipient`
                    },
                    failed: {
                        title: "Message Failed",
                        details: `Message ${messageId} failed to send${details?.error_details ? `: ${details.error_details}` : ''}`
                    },
                    stats_reset: {
                        title: "Statistics Reset",
                        details: `Broadcast statistics were reset manually`
                    }
                };

                const event = timelineEvents[status];
                if (event) {
                    await ctx.call("timeline.create", {
                        type: "broadcast",
                        reference: broadcastId,
                        event_type: "system",
                        title: event.title,
                        details: event.details,
                        status: status,
                        org_id: ctx.meta.org_id
                    });
                }
            } catch (error) {
                this.logger.error("Error recording broadcast timeline:", error);
            }
        },

        /**
         * Map WhatsApp status to broadcast status
         */
        mapWhatsAppStatus(whatsappStatus) {
            const statusMap = {
                "sent": "sent",
                "delivered": "delivered",
                "read": "read",
                "failed": "failed",
                "rejected": "failed",
                "deleted": "failed"
            };
            return statusMap[whatsappStatus] || "failed";
        },

        /**
         * Calculate broadcast completion percentage
         */
        calculateCompletionPercentage(stats) {
            const totalEnqueued = stats.total_enqueued || 0;
            if (totalEnqueued === 0) return 0;

            const totalProcessed = (stats.total_sent || 0) + (stats.total_failed || 0);
            return Math.round((totalProcessed / totalEnqueued) * 100);
        }
    },

    events: {
        // Listen for message status updates from WhatsApp webhook
        async "message.status.updated"(payload) {
            try {
                const { message_id, status, broadcast_id, error_details } = payload;

                // Update broadcast stats
                await this.broker.call("broadcast_stats.updateBroadcastStats", {
                    message_id,
                    status: this.mapWhatsAppStatus(status),
                    broadcast_id,
                    error_details
                });

            } catch (error) {
                this.logger.error("Error handling message status update event:", error);
            }
        }
    },

    created() {
        this.logger.info("Broadcast stats service created");
    },

    started() {
        this.logger.info("Broadcast stats service started");
    }
}; 