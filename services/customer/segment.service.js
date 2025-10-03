const dbMixin = require("../../mixins/db.mixin");
const { CreateSegmentAggregation, formatQuery } = require("../../utils/common");
const { MoleculerError } = require("moleculer").Errors;
const customerModel = require("../../models/customer.model");
const { ObjectId } = require("mongodb");

"use strict";


module.exports = {
    name: "segment",
    mixins: [dbMixin("segment")],
    /**
     * Service settings
     */
    settings: {
        // Add service settings here
    },

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {
        // Action to create a new segment
        createSegment: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/create-segment"
            },
            params: {
                title: { type: "string" },
                description: { type: "string", optional: true },
                rules: { type: "string" }
            },
            async handler(ctx) {
                try {
                    const { title, description, rules } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                        const response = await this.adapter.findOne({ title, org_id, branch_id });
                        if (response) {
                            return {
                                success: false,
                                message: "Segment already exists"
                            };
                        } else {
                            const segment = {
                                title,
                                created_at: Date.now(),
                                description,
                                org_id: new this.adapter.model.base.Types.ObjectId(org_id),
                                branch_id: new this.adapter.model.base.Types.ObjectId(branch_id),
                                rules,
                            };

                            const insertedSegment = await this.adapter.insert(segment);

                            return {
                                success: true,
                                message: "New Segment added successfully",
                                data: insertedSegment
                            };
                        }
                    }
                    else {
                        return new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }

                } catch (error) {
                    return new MoleculerError("Internal server error", 500, "INTERNAL_SERVER_ERROR", error.message);
                }
            }
        },

        updateSegment: {
            auth: "required",
            rest: {
                method: "PUT",
                path: "/update-segment"
            },
            params: {
                id: { type: "string" },
                title: { type: "string", optional: true },
                description: { type: "string", optional: true },
                rules: { type: "string", optional: true }
            },
            async handler(ctx) {
                try {
                    const { id, title, description, rules } = ctx.params;
                    if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                        const segment = await this.adapter.findById(id);
                        if (!segment) {
                            return {
                                code: "404",
                                success: false,
                                message: "Segment not found"
                            };
                        }
                        const updatedSegment = await this.adapter.updateById(id, {
                            $set: {
                                title,
                                description,
                                rules
                            }
                        });

                        return {
                            code: "200",
                            success: true,
                            message: "Segment updated successfully",
                            data: updatedSegment
                        };
                    }
                    else {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    return {
                        code: "500",
                        success: false,
                        message: "Internal server error",
                        error: error.message
                    };
                }
            }
        },

        // Action to get a Segments of items with audience count
        getSegments: {
            rest: {
                method: "GET",
                path: "/segments"
            },
            params: {
                first: { type: "string", optional: true },
                last: { type: "string", optional: true },
                after: { type: "string", optional: true },
                before: { type: "string", optional: true },
                filter: { type: "string", optional: true },
                search: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { org_id, branch_id } = ctx.meta;
                const { search, first, last, after, before, filter } = ctx.params;
                try {
                    // Fetch all lists for the given org_id and branch_id
                    if (ctx.meta.scopes.includes("customer_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("customer_write")) {
                        const aggregationQuery = CreateSegmentAggregation(org_id, branch_id, search, first, last, filter, after, before, false);

                        const Segments = await this.adapter.model.aggregate(aggregationQuery);
                        if (!Segments || Segments.length === 0) {
                            return {
                                code: "404",
                                success: false,
                                message: "No segments found",
                                data: []
                            };
                        }
                        // Fetch audience count for each segment
                        const segmentsWithAudienceCount = await Promise.all(
                            Segments.map(async (segment) => {
                                try {
                                    let matchQuery = {};
                                    Object.assign(matchQuery, formatQuery(JSON.parse(segment?.rules || '{}')));
                                    console.log('Match query for segment audience count:', JSON.stringify(matchQuery));

                                    const audienceCount = await ctx.call("customer.Getcount", {
                                        query: matchQuery,
                                    });

                                    return {
                                        ...segment,
                                        audience_count: audienceCount
                                    };
                                } catch (error) {
                                    this.logger.error(`Error calculating audience count for segment ${segment._id}: ${error.message}`);
                                    return {
                                        ...segment,
                                        audience_count: 0
                                    };
                                }
                            })
                        );

                        return {
                            code: "200",
                            success: true,
                            message: "Segment fetched successfully with audience count",
                            data: segmentsWithAudienceCount
                        };
                    }
                    else {
                        return {
                            code: "403",
                            success: false,
                            message: "Permission denied"
                        };
                    }
                } catch (error) {
                    this.logger.error('Error fetching segments:', error);
                    return {
                        code: "500",
                        success: false,
                        message: "Internal server error",
                        error: error.message
                    };
                }
            }
        },

        deleteSegment: {
            auth: "required",
            rest: {
                method: "DELETE",
            },
            params: {
                id: { type: "string" }
            },
            async handler(ctx) {
                try {
                    const { id } = ctx.params;

                    if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                        const deletedSegment = await this.adapter.removeById(id);

                        if (!deletedSegment) {
                            throw { message: "Segment not found", code: "404" };
                        }

                        return {
                            code: "200",
                            success: true,
                            message: "Segment deleted successfully"
                        };
                    } else {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    return {
                        code: "500",
                        success: false,
                        message: "Internal server error",
                        error: error.message
                    };
                }
            }
        },

        getSegmentById: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/:id"
            },
            params: {
                id: { type: "string" }
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes.includes("customer_read") || ctx.meta.scopes.includes("full_control")) {
                    const segment = await this.adapter.model.findById(id);
                    if (!segment) {
                        return {
                            success: false,
                            message: "Segment not found",
                            data: null
                        };
                    }
                    return {
                        success: true,
                        message: "Segment fetched successfully",
                        data: segment
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        // Action to manage WhatsApp consent for customers based on segment rules
        manageSegmentWhatsAppConsent: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/manage-whatsapp-consent"
            },
            params: {
                segmentId: { type: "string" },
                callType: { type: "string", enum: ["subscribe", "unsubscribe"] }
            },
            async handler(ctx) {
                try {
                    const { segmentId, callType } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                        // Find the segment to get its rules
                        const segment = await this.adapter.findById(segmentId);
                        if (!segment) {
                            return {
                                success: false,
                                message: "Segment not found"
                            };
                        }

                        // Parse the segment rules to create a query
                        let matchQuery = {};
                        try {
                            Object.assign(matchQuery, formatQuery(JSON.parse(segment?.rules)));
                        } catch (error) {
                            return {
                                success: false,
                                message: "Invalid segment rules format"
                            };
                        }
                        console.log(branch_id, org_id);
                        // Add org_id and branch_id to the query
                        matchQuery.org_id = new this.adapter.model.base.Types.ObjectId(org_id);
                        matchQuery.branch_id = new this.adapter.model.base.Types.ObjectId(branch_id);

                        const consentValue = callType === "subscribe";
                        console.log(matchQuery);
                        const updateResult = await customerModel.updateMany(
                            matchQuery,
                            {
                                $set: {
                                    whatsapp_marketing_consent: consentValue,
                                    updatedAt: new Date()
                                }
                            }
                        );

                        if (updateResult.matchedCount === 0) {
                            return {
                                success: false,
                                message: "No customers found matching segment rules"
                            };
                        }

                        // Get notification messages from config
                        const notifications = require("../../config/notifications.json");
                        const action = callType === "subscribe" ? "subscribe_to_whatsapp" : "unsubscribe_to_whatsapp";
                        const actionConfig = notifications.bulk_actions[action];

                        if (actionConfig) {
                            return {
                                success: true,
                                message: actionConfig.success,
                                title: actionConfig.title,
                                data: {
                                    segmentId: segmentId,
                                    callType: callType,
                                    action: action,
                                    customersMatched: updateResult.matchedCount,
                                    customersUpdated: updateResult.modifiedCount,
                                    notification: {
                                        title: actionConfig.title,
                                        description: actionConfig.success,
                                        type: "customers",
                                        icon: "check_circle"
                                    }
                                }
                            };
                        } else {
                            // Fallback response if notification config not found
                            const actionMessage = callType === "subscribe" ? "subscribed to" : "unsubscribed from";
                            return {
                                success: true,
                                message: `Segment customers ${actionMessage} WhatsApp successfully`,
                                data: {
                                    segmentId: segmentId,
                                    callType: callType,
                                    customersMatched: updateResult.matchedCount,
                                    customersUpdated: updateResult.modifiedCount
                                }
                            };
                        }
                    } else {
                        return new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    this.logger.error(`Error managing WhatsApp consent for segment:`, error);
                    return new MoleculerError("Internal server error", 500, "INTERNAL_SERVER_ERROR", error.message);
                }
            }
        },

        // Action to convert segment to list
        convertSegmentToList: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/convert-to-list"
            },
            params: {
                segmentId: { type: "string" }
            },
            async handler(ctx) {
                try {
                    const { segmentId } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (!ctx.meta.scopes.includes("customer_write") && !ctx.meta.scopes.includes("full_control")) {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }

                    // Start database session for transaction
                    const session = await this.adapter.model.db.startSession();

                    try {
                        await session.withTransaction(async () => {
                            // 1. Get the segment details
                            const segment = await this.adapter.findById(segmentId);
                            if (!segment) {
                                throw new MoleculerError("Segment not found", 404, "NOT_FOUND");
                            }

                            // Verify segment belongs to the same org and branch
                            if (segment.org_id.toString() !== org_id || segment.branch_id.toString() !== branch_id) {
                                throw new MoleculerError("Segment not found", 404, "NOT_FOUND");
                            }

                            // 2. Create a new list with the same name
                            const listResult = await ctx.call("list.createList", {
                                title: segment.title,
                                description: segment.description || `Converted from segment: ${segment.title}`
                            }, { meta: { org_id, branch_id, scopes: ctx.meta.scopes } });
                            if (!listResult.success) {
                                throw new MoleculerError(`Failed to create list: ${listResult.message}`, 500, "INTERNAL_SERVER_ERROR");
                            }

                            const newListId = listResult.data._id;

                            // 3. Get customers that match the segment rules
                            const customerModel = require("../../models/customer.model");
                            let matchQuery = {};

                            try {
                                Object.assign(matchQuery, require("../../utils/common").formatQuery(JSON.parse(segment.rules)));
                            } catch (error) {
                                throw new MoleculerError("Invalid segment rules format", 400, "BAD_REQUEST");
                            }

                            // Add org_id and branch_id to the query
                            matchQuery.org_id = new customerModel.base.Types.ObjectId(org_id);
                            matchQuery.branch_id = new customerModel.base.Types.ObjectId(branch_id);

                            // 4. Update customers to add the new list ID
                            const updateResult = await customerModel.updateMany(
                                matchQuery,
                                { $addToSet: { lists: newListId } },
                                { session }
                            );

                            if (updateResult.matchedCount === 0) {
                                throw new MoleculerError("No customers found matching segment rules", 400, "BAD_REQUEST");
                            }

                            // 5. Delete the segment
                            const deleteResult = await this.adapter.removeById(segmentId, { session });
                            if (!deleteResult) {
                                throw new MoleculerError("Failed to delete segment", 500, "INTERNAL_SERVER_ERROR");
                            }

                            return {
                                success: true,
                                message: "Segment successfully converted to list",
                                data: {
                                    segmentId: segmentId,
                                    newListId: newListId,
                                    customersUpdated: updateResult.modifiedCount,
                                    customersMatched: updateResult.matchedCount
                                }
                            };
                        });

                        // If we reach here, transaction was successful
                        return {
                            success: true,
                            message: "Segment successfully converted to list",
                            data: {
                                segmentId: segmentId,
                                message: "Conversion completed successfully"
                            }
                        };

                    } catch (error) {
                        // Transaction will automatically rollback on error
                        throw error;
                    } finally {
                        // Always end the session
                        await session.endSession();
                    }

                } catch (error) {
                    this.logger.error('Error converting segment to list:', error);

                    if (error instanceof MoleculerError) {
                        throw error;
                    }

                    return new MoleculerError(
                        "Internal server error",
                        500,
                        "INTERNAL_SERVER_ERROR",
                        error.message
                    );
                }
            }
        },

        bulkUpdateSegment: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/bulk-update-segment"
            },
            params: {
                segments: {
                    type: "array",
                    items: { type: "string" },
                },
                action: {
                    type: "string",
                    enum: ["delete", "subscribe", "unsubscribe"],
                }
            },
            async handler(ctx) {
                try {
                    const { segments, action } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    // Check permissions
                    if (!ctx.meta.scopes.includes("customer_write") && !ctx.meta.scopes.includes("full_control")) {
                        return {
                            code: "403",
                            success: false,
                            message: "Permission denied. Requires customer_write or full_control scope."
                        };
                    }

                    // Validate that all segment IDs exist and belong to the same org/branch
                    const segmentIds = segments.map(id => id);
                    const existingSegments = await this.adapter.model.find({
                        _id: { $in: segmentIds.map(id => new ObjectId(id)) },
                        org_id,
                        branch_id
                    });

                    if (existingSegments.length !== segmentIds.length) {
                        const foundIds = existingSegments.map(segment => segment._id.toString());
                        const missingIds = segments.filter(id => !foundIds.includes(id));

                        return {
                            code: "400",
                            success: false,
                            message: "Some segments not found or don't belong to your organization",
                            data: {
                                missingIds: missingIds,
                                totalRequested: segments.length,
                                totalFound: existingSegments.length
                            }
                        };
                    }

                    this.processBulkUpdateSegment(
                        segments, 
                        action, 
                        org_id, 
                        branch_id, 
                        ctx.meta.user_id
                    );

                    return {
                        code: "200",
                        success: true,
                        message: `Bulk ${action} process started`,
                        data: {
                            action: action,
                            totalRequested: segments.length
                        }
                    };

                } catch (error) {
                    this.logger.error(`Error in bulkUpdateSegment action: ${error.message}`);
                    return {
                        code: "500",
                        success: false,
                        message: "Internal server error during bulk operation",
                        error: error.message
                    };
                }
            }
        },
    },

    /**
     * Events
     */
    events: {
        // Add event handlers hered
    },

    /**
     * Methods
     */
    methods: {
        // Add custom methods here
        
        /**
         * Process bulk update segment operations
         * @param {Array} segments - Array of segment IDs
         * @param {string} action - Action to perform (delete, subscribe, unsubscribe)
         * @param {string} org_id - Organization ID
         * @param {string} branch_id - Branch ID
         * @param {string} user_id - User ID for notifications
         * @returns {Object} Processing results
         */
        async processBulkUpdateSegment(segments, action, org_id, branch_id, user_id) {
            const results = [];
            const processedSegments = [];

            if (action === "delete") {
                // Handle bulk delete
                for (const segmentId of segments) {
                    try {
                        // Find customers in this segment and remove segment ID from their segments array
                        const segment = await this.adapter.findById(segmentId);

                        // Check if segment exists
                        if (!segment) {
                            results.push({
                                id: segmentId,
                                success: false,
                                message: "Segment not found",
                                error: "Segment does not exist"
                            });
                        }

                        // Delete the segment
                        const deletedSegment = await this.adapter.removeById(segmentId);

                        if (deletedSegment) {
                            results.push({
                                id: segmentId,
                                success: true,
                                message: "Segment deleted successfully"
                            });
                            processedSegments.push(deletedSegment);
                        } else {
                            results.push({
                                id: segmentId,
                                success: false,
                                message: "Failed to delete segment",
                                error: "Delete operation returned no result"
                            });
                        }
                    } catch (error) {
                        results.push({
                            id: segmentId,
                            success: false,
                            message: "Error deleting segment",
                            error: error.message
                        });
                    }
                }

                // Send notification based on results
                try {
                    const successfulCount = results.filter(r => r.success).length;
                    const failedCount = results.filter(r => !r.success).length;

                    if (failedCount === 0) {
                        // All successful - send success notification
                        await this.broker.call("notification.send", {
                            templateKey: "bulk_segment_delete_completed",
                            variables: {
                                totalSegments: segments.length
                            },
                            additionalData: {
                                organisation_id: org_id.toString(),
                                user_id: user_id || "",
                                branch_id: branch_id.toString()
                            }
                        });
                    } else if (failedCount > 0) {
                        // Some failed - send failure notification
                        await this.broker.call("notification.send", {
                            templateKey: "bulk_segment_delete_failed",
                            variables: {
                                totalSegments: segments.length,
                                failedCount: failedCount
                            },
                            additionalData: {
                                organisation_id: org_id.toString(),
                                user_id: user_id || "",
                                branch_id: branch_id.toString()
                            }
                        });
                    }
                } catch (notificationError) {
                    this.logger.error(`Failed to send notification for bulk segment delete: ${notificationError.message}`);
                    // Don't fail the main operation if notification fails
                }

            } else if (action === "subscribe") {
                // Handle bulk subscribe to marketing communications - always update all consent types
                const updateFields = {
                    whatsapp_marketing_consent: true,
                    sms_marketing_consent: true,
                    email_marketing_consent: true
                };

                // Update all customers in all the segments
                let totalCustomersUpdated = 0;
                let totalCustomersMatched = 0;
                const BATCH_SIZE = 5000; // Process customers in batches of 1000

                for (const segmentId of segments) {
                    try {
                        const segment = await this.adapter.findById(segmentId);

                        // Check if segment exists
                        if (!segment) {
                            this.logger.error(`Segment ${segmentId} not found during subscribe operation`);
                            return {
                                code: "404",
                                success: false,
                                message: "Segment not found"
                            };
                        }

                        if (segment && segment.rules) {
                            // Parse the rules to build the query
                            const rules = JSON.parse(segment.rules);
                            const matchQuery = formatQuery(rules);

                            // Add org_id and branch_id to the query
                            matchQuery.org_id = new ObjectId(org_id);
                            matchQuery.branch_id = new ObjectId(branch_id);

                            // First, count total customers that match the segment
                            const totalMatchingCustomers = await customerModel.countDocuments(matchQuery);
                            
                            if (totalMatchingCustomers === 0) {
                                this.logger.info(`No customers found for segment ${segmentId}`);
                                continue;
                            }

                            this.logger.info(`Processing ${totalMatchingCustomers} customers for segment ${segmentId} in batches of ${BATCH_SIZE}`);

                            // Process customers in batches to avoid timeout
                            let processedCount = 0;
                            let offset = 0;

                            while (processedCount < totalMatchingCustomers) {
                                try {
                                    // Get batch of customer IDs
                                    const customerBatch = await customerModel.find(matchQuery, { _id: 1 })
                                        .skip(offset)
                                        .limit(BATCH_SIZE)
                                        .lean();

                                    if (customerBatch.length === 0) break;

                                    const customerIds = customerBatch.map(c => c._id);

                                    // Update this batch of customers
                                    const result = await customerModel.updateMany(
                                        { _id: { $in: customerIds } },
                                        { $set: updateFields }
                                    );

                                    totalCustomersUpdated += result.modifiedCount;
                                    totalCustomersMatched += result.matchedCount;
                                    processedCount += customerBatch.length;
                                    offset += BATCH_SIZE;

                                    this.logger.info(`Processed batch: ${customerBatch.length} customers, Total processed: ${processedCount}/${totalMatchingCustomers}`);

                                    // Add small delay between batches to prevent overwhelming the database
                                    if (processedCount < totalMatchingCustomers) {
                                        await new Promise(resolve => setTimeout(resolve, 100));
                                    }

                                } catch (batchError) {
                                    this.logger.error(`Error processing batch for segment ${segmentId}: ${batchError.message}`);
                                    // Continue with next batch instead of failing completely
                                    offset += BATCH_SIZE;
                                    processedCount += BATCH_SIZE;
                                }
                            }

                            this.logger.info(`Completed processing segment ${segmentId}: ${processedCount} customers processed`);
                        }
                    } catch (error) {
                        this.logger.error(`Error updating customers in segment ${segmentId}: ${error.message}`);
                    }
                }

                results.push({
                    action: "subscribe",
                    consent_types: ["whatsapp", "sms", "email"],
                    customers_updated: totalCustomersUpdated,
                    total_customers: totalCustomersMatched
                });

                // Send notification for subscribe action
                try {
                    await this.broker.call("notification.send", {
                        templateKey: "bulk_segment_subscribe_completed",
                        variables: {
                            totalSegments: segments.length,
                            customersUpdated: totalCustomersUpdated,
                            totalCustomers: totalCustomersMatched
                        },
                        additionalData: {
                            organisation_id: org_id.toString(),
                            user_id: user_id || "",
                            branch_id: branch_id.toString()
                        }
                    });
                } catch (notificationError) {
                    this.logger.error(`Failed to send notification for bulk segment subscribe: ${notificationError.message}`);
                    // Don't fail the main operation if notification fails
                }

            } else if (action === "unsubscribe") {
                // Handle bulk unsubscribe from marketing communications - always update all consent types
                const updateFields = {
                    whatsapp_marketing_consent: false,
                    sms_marketing_consent: false,
                    email_marketing_consent: false
                };

                // Update all customers in all the segments
                let totalCustomersUpdated = 0;
                let totalCustomersMatched = 0;
                const BATCH_SIZE = 5000; // Process customers in batches of 1000

                for (const segmentId of segments) {
                    try {
                        const segment = await this.adapter.findById(segmentId);

                        // Check if segment exists
                        if (!segment) {
                            this.logger.error(`Segment ${segmentId} not found during unsubscribe operation`);
                            return {
                                code: "404",
                                success: false,
                                message: "Segment not found"
                            };
                        }

                        if (segment && segment.rules) {
                            // Parse the rules to build the query
                            const rules = JSON.parse(segment.rules);
                            const matchQuery = formatQuery(rules);

                            // Add org_id and branch_id to the query
                            matchQuery.branch_id = new ObjectId(branch_id);
                            matchQuery.org_id = new ObjectId(org_id);

                            // First, count total customers that match the segment
                            const totalMatchingCustomers = await customerModel.countDocuments(matchQuery);
                            
                            if (totalMatchingCustomers === 0) {
                                this.logger.info(`No customers found for segment ${segmentId}`);
                                continue;
                            }

                            this.logger.info(`Processing ${totalMatchingCustomers} customers for segment ${segmentId} in batches of ${BATCH_SIZE}`);

                            // Process customers in batches to avoid timeout
                            let processedCount = 0;
                            let offset = 0;

                            while (processedCount < totalMatchingCustomers) {
                                try {
                                    // Get batch of customer IDs
                                    const customerBatch = await customerModel.find(matchQuery, { _id: 1 })
                                        .skip(offset)
                                        .limit(BATCH_SIZE)
                                        .lean();

                                    if (customerBatch.length === 0) break;

                                    const customerIds = customerBatch.map(c => c._id);

                                    // Update this batch of customers
                                    const result = await customerModel.updateMany(
                                        { _id: { $in: customerIds } },
                                        { $set: updateFields }
                                    );

                                    totalCustomersUpdated += result.modifiedCount;
                                    totalCustomersMatched += result.matchedCount;
                                    processedCount += customerBatch.length;
                                    offset += BATCH_SIZE;

                                    this.logger.info(`Processed batch: ${customerBatch.length} customers, Total processed: ${processedCount}/${totalMatchingCustomers}`);

                                    // Add small delay between batches to prevent overwhelming the database
                                    if (processedCount < totalMatchingCustomers) {
                                        await new Promise(resolve => setTimeout(resolve, 100));
                                    }

                                } catch (batchError) {
                                    this.logger.error(`Error processing batch for segment ${segmentId}: ${batchError.message}`);
                                    // Continue with next batch instead of failing completely
                                    offset += BATCH_SIZE;
                                    processedCount += BATCH_SIZE;
                                }
                            }

                            this.logger.info(`Completed processing segment ${segmentId}: ${processedCount} customers processed`);
                        }
                    } catch (error) {
                        this.logger.error(`Error updating customers in segment ${segmentId}: ${error.message}`);
                    }
                }

                results.push({
                    action: "unsubscribe",
                    consent_types: ["whatsapp", "sms", "email"],
                    customers_updated: totalCustomersUpdated,
                    total_customers: totalCustomersMatched
                });

                // Send notification for unsubscribe action
                try {
                    await this.broker.call("notification.send", {
                        templateKey: "bulk_segment_unsubscribe_completed",
                        variables: {
                            totalSegments: segments.length,
                            customersUpdated: totalCustomersUpdated,
                            totalCustomers: totalCustomersMatched
                        },
                        additionalData: {
                            organisation_id: org_id.toString(),
                            user_id: user_id || "",
                            branch_id: branch_id.toString()
                        }
                    });
                } catch (notificationError) {
                    this.logger.error(`Failed to send notification for bulk segment unsubscribe: ${notificationError.message}`);
                    // Don't fail the main operation if notification fails
                }
            }

            return {
                results,
                processedSegments
            };
        }
    },

    /**
     * Service lifecycle events
     */
    created() {
        // Called when the service is created
    },

    started() {
        // Called when the service is started
    },

    stopped() {
        // Called when the service is stopped
    }
};