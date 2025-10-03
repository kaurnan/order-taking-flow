const dbMixin = require("../../mixins/db.mixin");
const customerModel = require("../../models/customer.model");
const { CreateListAggregation } = require("../../utils/common");
const { ObjectId } = require("mongodb");
const { MoleculerError } = require("moleculer").Errors;

"use strict";


module.exports = {
    name: "list",
    mixins: [dbMixin("list")],
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


        // Action to create a new list
        createList: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/create-list"
            },
            params: {
                title: { type: "string" },
                description: { type: "string", optional: true },
            },
            async handler(ctx) {
                try {
                    const { title, description } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                        const response = await this.adapter.findOne({ title, org_id, branch_id });
                        if (response) {
                            return {
                                code: "400",
                                success: false,
                                message: "List already exists"
                            };
                        } else {
                            const list = {
                                title,
                                created_at: Date.now(),
                                description,
                                org_id,
                                branch_id,
                            };

                            const insertedList = await this.adapter.insert(list);

                            return {
                                code: "200",
                                success: true,
                                message: "New List added successfully",
                                data: insertedList
                            };
                        }
                    }
                    else {
                        return {
                            code: "403",
                            success: false,
                            message: "Permission denied"
                        };
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

        updateList: {
            auth: "required",
            rest: {
                method: "PUT",
                path: "/update-list"
            },
            params: {
                id: { type: "string" },
                type: { type: "enum", values: ["rename", "suppress", "unsuppress"] },
                data: { type: "any" },
            },
            async handler(ctx) {
                try {
                    const { id, type, data } = ctx.params;
                    if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                        if (type === "rename") {
                            if (!data) {
                                throw { message: "Title is required for renaming", code: "400" };
                            }
                            const renamedList = await this.adapter.updateById(id, {
                                $set: {
                                    title: data,
                                }
                            });

                            if (!renamedList) {
                                throw { message: "List not found", code: "404" };
                            }
                        } else {
                            throw { message: "type is not correct", code: "400" };
                        }

                        return {
                            code: "200",
                            success: true,
                            message: `List ${type}d successfully`,
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

        // Action to get a list of items with audience count
        getList: {
            rest: {
                method: "GET",
                path: "/list"
            },
            params: {
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                filter: { type: "string", optional: true },
                search: { type: "string", optional: true },
            },
            async handler(ctx) {
                if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("customer_read")) {
                    const { org_id, branch_id } = ctx.meta;
                    const { search, page, pageSize, filter } = ctx.params;

                    // Fetch all lists for the given org_id and branch_id
                    if (ctx.meta.scopes.includes("customer_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("customer_write")) {
                        const aggregationQuery = CreateListAggregation(org_id, branch_id, search, null, null, filter, null, null, false, true);
                        const skipValue = (parseInt(page) - 1) * parseInt(pageSize);
                        aggregationQuery.push(
                            { $skip: skipValue },
                            { $limit: parseInt(pageSize) }
                        );

                        // Get total count for pagination info
                        const total = await this.adapter.model.countDocuments(aggregationQuery[0].$match || {});
                        const lists = await this.adapter.model.aggregate(aggregationQuery);
                        if (!lists || lists.length === 0) {
                            return {
                                code: "404",
                                success: false,
                                message: "No lists found"
                            };
                        }
                        // Fetch audience count for each list
                        const listsWithAudienceCount = await Promise.all(
                            lists.map(async (list) => {
                                const audienceCount = await ctx.call("customer.Getcount", {
                                    query: { lists: { $in: [list._id] } },
                                });
                                console.log({
                                    ...list,
                                    audience_count: audienceCount
                                });
                                return {
                                    ...list,
                                    audience_count: audienceCount
                                };
                            })
                        );

                        return {
                            code: "200",
                            success: true,
                            message: "List fetched successfully with audience count",
                            data: listsWithAudienceCount,
                            pagination: {
                                total: total,
                                page: parseInt(page),
                                pageSize: parseInt(pageSize),
                                totalPages: Math.ceil(total / parseInt(pageSize)),
                            }
                        };
                    }
                    else {
                        return {
                            code: "403",
                            success: false,
                            message: "Permission denied"
                        };
                    }
                } else {
                    return {
                        code: "403",
                        success: false,
                        message: "Permission denied"
                    };
                }
            }
        },

        getListById: {
            rest: {
                method: "GET",
            },
            params: {
                id: "string"
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes.includes("customer_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("customer_write")) {
                    const { org_id, branch_id } = ctx.meta;
                    // Check if the list exists for the given org_id and branch_id
                    const list = await this.adapter.findOne({ _id: new ObjectId(id), org_id, branch_id });
                    if (!list) {
                        return {
                            code: "404",
                            success: false,
                            message: "List not found"
                        };
                    }

                    // Fetch audience count for this list using the customer model directly

                    const audienceCount = await customerModel.countDocuments({ lists: { $in: [list._id] } });

                    return {
                        success: true,
                        message: "List fetched successfully",
                        data: {
                            ...list.toJSON(),
                            audience_count: audienceCount
                        }
                    };
                }
                else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        deleteList: {
            auth: "required",
            rest: {
                method: "DELETE",
            },
            params: {
                id: "string"
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                    // Remove the list ID from all customers who have it in their lists array
                    await customerModel.updateMany(
                        {
                            lists: { $in: [new ObjectId(id)] },
                            org_id: new ObjectId(org_id),
                            branch_id: new ObjectId(branch_id)
                        },
                        {
                            $pull: { lists: new ObjectId(id) }
                        }
                    );
                    const deletedList = await this.adapter.removeById(id);
                    if (!deletedList) {
                        throw new MoleculerError("List not found", 404, "NOT_FOUND");
                    }

                    return {
                        code: "200",
                        success: true,
                        message: "List deleted successfully"
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        // Action to add an item to the list
        addItem: {
            rest: {
                method: "POST",
                path: "/list"
            },
            params: {
                name: "string"
            },
            async handler(ctx) {
                const { name } = ctx.params;
                return { id: Date.now(), name };
            }
        },

        // Action to export customers to CSV
        exportListCustomers: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/export"
            },
            params: {
                listId: { type: "string" },
            },
            async handler(ctx) {
                try {
                    const { org_id, branch_id } = ctx.meta;
                    const { listId, customerIds } = ctx.params;

                    if (ctx.meta.scopes.includes("customer_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("customer_write")) {
                        let query = {
                            org_id: org_id,
                            branch_id: branch_id,
                        };

                        if (listId) {
                            query.lists = { $in: [listId] };
                        }

                        this.logger.info(`Calling bulkaction.exportCustomers with query: ${JSON.stringify(query)}`);
                        // The bulkaction.exportCustomers service handles the actual export and notifications.
                        // It returns a promise that resolves when the export is initiated.
                        // The actual file URL and count will be part of the notification, not directly returned here.
                        await ctx.call("bulkaction.exportCustomers", { query });

                        return {
                            success: true,
                            message: "Customer export initiated successfully. You will be notified when the export is complete.",
                            data: null // Data will be provided via notification
                        };
                    } else {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    this.logger.error(`Error in exportCustomers action: ${error.message}`);
                    return {
                        success: false,
                        message: error.message || "Internal server error",
                        error: error.message
                    };
                }
            }
        },

        // Action to merge multiple lists into a destination list
        mergeList: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/merge-list"
            },
            params: {
                sourceListIds: { type: "array", items: "string" },
                destinationListId: { type: "string" },
                deleteSourceLists: { type: "boolean", default: false }
            },
            async handler(ctx) {
                try {
                    const { sourceListIds, destinationListId, deleteSourceLists } = ctx.params;
                    const { org_id, branch_id, user_id } = ctx.meta;

                    // Check permissions
                    if (!ctx.meta.scopes.includes("customer_write") && !ctx.meta.scopes.includes("full_control")) {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }

                    // Validate input parameters
                    if (!sourceListIds || !Array.isArray(sourceListIds) || sourceListIds.length === 0) {
                        throw new MoleculerError("Source list IDs are required and must be an array", 400, "BAD_REQUEST");
                    }

                    if (!destinationListId) {
                        throw new MoleculerError("Destination list ID is required", 400, "BAD_REQUEST");
                    }

                    // Check if source and destination are the same
                    if (sourceListIds.includes(destinationListId)) {
                        throw new MoleculerError("Source and destination lists cannot be the same", 400, "BAD_REQUEST");
                    }

                    // Validate that all lists exist and belong to the same org/branch
                    const allListIds = [...sourceListIds, destinationListId];
                    const lists = await this.adapter.find({
                        _id: { $in: allListIds.map(id => new ObjectId(id)) },
                        org_id: new ObjectId(org_id),
                        branch_id: new ObjectId(branch_id)
                    });

                    const destinationList = lists.find(list => list._id.toString() === destinationListId);
                    const sourceLists = lists.filter(list => sourceListIds.includes(list._id.toString()));

                    // Queue the merge list job in the background
                    const jobParams = {
                        sourceListIds,
                        destinationListId,
                        deleteSourceLists,
                        org_id,
                        branch_id,
                        user_id
                    };

                    // Add job directly to BullMQ queue
                    const mergeListQueue = require('../../queues/merge-list.queue');

                    const job = await mergeListQueue.add('merge-list', jobParams, {
                        jobId: `merge-list-${org_id}-${branch_id}-${Date.now()}`,
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 2000
                        },
                        removeOnComplete: {
                            age: 3600, // Keep completed jobs for 1 hour
                        },
                        removeOnFail: {
                            age: 24 * 3600, // Keep failed jobs for 24 hours
                        }
                    });

                    return {
                        code: "202",
                        success: true,
                        message: "Merge list job has been queued and will be processed in the background",
                        data: {
                            jobId: job.id,
                            jobStatus: "queued",
                            destinationList: destinationList.title,
                            sourceListCount: sourceLists.length,
                            estimatedTime: "This process may take several minutes depending on the number of customers",
                            trackProgress: `Use job ID ${job.id} to track progress`
                        }
                    };

                } catch (error) {
                    this.logger.error(`Error in mergeList action: ${error.message}`);
                    return {
                        code: error.code || "500",
                        success: false,
                        message: error.message || "Internal server error",
                        error: error.message
                    };
                }
            }
        },

        bulkUpdateList: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/bulk-update-list"
            },
            params: {
                lists: {
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
                    const { lists, action } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;
                    console.log(org_id, branch_id);
                    // Check permissions
                    if (!ctx.meta.scopes.includes("customer_write") && !ctx.meta.scopes.includes("full_control")) {
                        return {
                            code: "403",
                            success: false,
                            message: "Permission denied. Requires customer_write or full_control scope."
                        };
                    }

                    // Validate that all list IDs exist and belong to the same org/branch
                    const listIds = lists.map(id => id);
                    const existingLists = await this.adapter.model.find({
                        _id: { $in: listIds.map(id => new ObjectId(id)) },
                        org_id,
                        branch_id
                    });
                    console.log("Existing Lists:", existingLists);

                    if (existingLists.length !== listIds.length) {
                        const foundIds = existingLists.map(list => list._id.toString());
                        const missingIds = lists.filter(id => !foundIds.includes(id));

                        return {
                            code: "400",
                            success: false,
                            message: "Some lists not found or don't belong to your organization",
                            data: {
                                missingIds: missingIds,
                                totalRequested: lists.length,
                                totalFound: existingLists.length
                            }
                        };
                    }

                    // Call the processing method
                    this.processBulkUpdateList(
                        lists,
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
                            totalRequested: lists.length,
                        }
                    };

                } catch (error) {
                    this.logger.error(`Error in bulkUpdateList action: ${error.message}`);
                    return {
                        code: "500",
                        success: false,
                        message: "Internal server error during bulk operation",
                        error: error.message
                    };
                }
            }
        }
    },

    /**
     * Events
     */
    events: {
        // Add event handlers here
    },

    /**
     * Methods
     */
    methods: {
        // Add custom methods here
        async processBulkUpdateList(lists, action, org_id, branch_id, user_id) {
            const results = [];
            const processedLists = [];

            if (action === "delete") {
                // Handle bulk delete
                for (const listId of lists) {
                    try {
                        // Remove the list ID from all customers who have it in their lists array
                        await customerModel.updateMany(
                            {
                                lists: { $in: [new ObjectId(listId)] },
                                org_id: new ObjectId(org_id),
                                branch_id: new ObjectId(branch_id)
                            },
                            {
                                $pull: { lists: new ObjectId(listId) }
                            }
                        );

                        // Delete the list
                        const deletedList = await this.adapter.removeById(listId);

                        if (deletedList) {
                            results.push({
                                id: listId,
                                success: true,
                                message: "List deleted successfully"
                            });
                            processedLists.push(deletedList);
                        } else {
                            results.push({
                                id: listId,
                                success: false,
                                message: "Failed to delete list",
                                error: "Delete operation returned no result"
                            });
                        }
                    } catch (error) {
                        results.push({
                            id: listId,
                            success: false,
                            message: "Error deleting list",
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
                        await ctx.call("notification.send", {
                            templateKey: "bulk_list_delete_completed",
                            variables: {
                                totalLists: lists.length
                            },
                            additionalData: {
                                organisation_id: org_id.toString(),
                                user_id: user_id || "",
                                branch_id: branch_id.toString()
                            }
                        });
                    } else if (failedCount > 0) {
                        // Some failed - send failure notification
                        await ctx.call("notification.send", {
                            templateKey: "bulk_list_delete_failed",
                            variables: {
                                totalLists: lists.length,
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
                    this.logger.error(`Failed to send notification for bulk list delete: ${notificationError.message}`);
                    // Don't fail the main operation if notification fails
                }
            } else if (action === "subscribe") {
                // Handle bulk subscribe to marketing communications - always update all consent types
                const updateFields = {
                    whatsapp_marketing_consent: true,
                    sms_marketing_consent: true,
                    email_marketing_consent: true
                };

                // Update all customers in all the lists using batch processing
                let totalCustomersUpdated = 0;
                let totalCustomersMatched = 0;
                const BATCH_SIZE = 5000; // Process customers in batches of 1000

                for (const listId of lists) {
                    try {
                        // First, count total customers in this list
                        const totalMatchingCustomers = await customerModel.countDocuments({
                            lists: { $in: [new ObjectId(listId)] },
                            org_id: new ObjectId(org_id),
                            branch_id: new ObjectId(branch_id)
                        });

                        if (totalMatchingCustomers === 0) {
                            this.logger.info(`No customers found for list ${listId}`);
                            continue;
                        }

                        this.logger.info(`Processing ${totalMatchingCustomers} customers for list ${listId} in batches of ${BATCH_SIZE}`);

                        // Process customers in batches to avoid timeout
                        let processedCount = 0;
                        let offset = 0;

                        while (processedCount < totalMatchingCustomers) {
                            try {
                                // Get batch of customer IDs
                                const customerBatch = await customerModel.find({
                                    lists: { $in: [new ObjectId(listId)] },
                                    org_id: new ObjectId(org_id),
                                    branch_id: new ObjectId(branch_id)
                                }, { _id: 1 })
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
                                this.logger.error(`Error processing batch for list ${listId}: ${batchError.message}`);
                                // Continue with next batch instead of failing completely
                                offset += BATCH_SIZE;
                                processedCount += BATCH_SIZE;
                            }
                        }

                        this.logger.info(`Completed processing list ${listId}: ${processedCount} customers processed`);
                    } catch (error) {
                        this.logger.error(`Error updating customers in list ${listId}: ${error.message}`);
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
                        templateKey: "bulk_list_subscribe_completed",
                        variables: {
                            totalLists: lists.length,
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
                    this.logger.error(`Failed to send notification for bulk list subscribe: ${notificationError.message}`);
                    // Don't fail the main operation if notification fails
                }

            } else if (action === "unsubscribe") {
                // Handle bulk unsubscribe from marketing communications - always update all consent types
                const updateFields = {
                    whatsapp_marketing_consent: false,
                    sms_marketing_consent: false,
                    email_marketing_consent: false
                };

                // Update all customers in all the lists using batch processing
                let totalCustomersUpdated = 0;
                let totalCustomersMatched = 0;
                const BATCH_SIZE = 5000; // Process customers in batches of 1000

                for (const listId of lists) {
                    try {
                        // First, count total customers in this list
                        const totalMatchingCustomers = await customerModel.countDocuments({
                            lists: { $in: [new ObjectId(listId)] },
                            org_id: new ObjectId(org_id),
                            branch_id: new ObjectId(branch_id)
                        });

                        if (totalMatchingCustomers === 0) {
                            this.logger.info(`No customers found for list ${listId}`);
                            continue;
                        }

                        this.logger.info(`Processing ${totalMatchingCustomers} customers for list ${listId} in batches of ${BATCH_SIZE}`);

                        // Process customers in batches to avoid timeout
                        let processedCount = 0;
                        let offset = 0;

                        while (processedCount < totalMatchingCustomers) {
                            try {
                                // Get batch of customer IDs
                                const customerBatch = await customerModel.find({
                                    lists: { $in: [new ObjectId(listId)] },
                                    org_id: new ObjectId(org_id),
                                    branch_id: new ObjectId(branch_id)
                                }, { _id: 1 })
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
                                this.logger.error(`Error processing batch for list ${listId}: ${batchError.message}`);
                                // Continue with next batch instead of failing completely
                                offset += BATCH_SIZE;
                                processedCount += BATCH_SIZE;
                            }
                        }

                        this.logger.info(`Completed processing list ${listId}: ${processedCount} customers processed`);
                    } catch (error) {
                        this.logger.error(`Error updating customers in list ${listId}: ${error.message}`);
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
                        templateKey: "bulk_list_unsubscribe_completed",
                        variables: {
                            totalLists: lists.length,
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
                    this.logger.error(`Failed to send notification for bulk list unsubscribe: ${notificationError.message}`);
                    // Don't fail the main operation if notification fails
                }
            }

            return { results, processedLists };
        }
    },

    /**
     * Service lifecycle events
     */
    created() {
    },

    started() {
        // Called when the service is started
    },

    stopped() {
        // Called when the service is stopped
    }
};
