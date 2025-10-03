const DbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");

"use strict";


module.exports = {
    name: "customerexport",
    mixins: [DbMixin("customerexport")],
    settings: {
        // Add service settings here if needed
    },
    events: {
        // Add event handlers here if needed
    },
    actions: {
        listExports: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/exports"
            },
            params: {
                page: { type: "number", integer: true, min: 1, optional: true, convert: true, default: 1 },
                pageSize: { type: "number", integer: true, min: 1, max: 100, optional: true, convert: true, default: 10 },
                search: { type: "string", optional: true, trim: true }
            },
            async handler(ctx) {
                console.log("Fetching exports for organisation ID:", ctx.meta.org_id);
                const orgId = new ObjectId(ctx.meta.org_id);
                const branch_id = new ObjectId(ctx.meta.branch_id);

                const page = ctx.params.page || 1;
                const pageSize = ctx.params.pageSize || 10;
                const skip = (page - 1) * pageSize;

                const query = {
                    org_id: orgId,
                    branch_id: branch_id
                };

                // Add search functionality
                if (ctx.params.search) {
                    const searchRegex = new RegExp(ctx.params.search, "i");
                    // Adjust the fields to search as needed
                    query.$or = [
                        { title: searchRegex }
                    ];
                }


                const sort = { createdAt: -1 };

                const [exports, total] = await Promise.all([
                    this.adapter.model.find(query).sort(sort).skip(skip).limit(pageSize),
                    this.adapter.model.countDocuments(query)
                ]);

                if (!exports || exports.length === 0) {
                    return {
                        success: true,
                        message: "No customer export history found",
                        data: []
                    }
                }

                return {
                    code: "200",
                    success: true,
                    message: "Customer Export History fetched successfully",
                    data: exports,
                    pagination: {
                        page,
                        pageSize,
                        total,
                        totalPages: Math.ceil(total / pageSize)
                    }
                };
            }
        },
        deleteExport: {
            cache: false,
            auth: "required",
            rest: {
                method: "DELETE"
            },
            params: {
                id: { type: "string", optional: false }
            },
            async handler(ctx) {
                console.log("Deleting export with ID:", ctx.params.id);

                try {
                    const exportId = new ObjectId(ctx.params.id);
                    const orgId = new ObjectId(ctx.meta.org_id);
                    const branchId = new ObjectId(ctx.meta.branch_id);

                    // Find the export to ensure it exists and belongs to the organization
                    const exportRecord = await this.adapter.model.findOne({
                        _id: exportId,
                        org_id: orgId,
                        branch_id: branchId
                    });

                    if (!exportRecord) {
                        throw new MoleculerError("Export not found", 404, "EXPORT_NOT_FOUND");
                    }

                    // Delete the export
                    const result = await this.adapter.model.deleteOne({
                        _id: exportId,
                        org_id: orgId,
                        branch_id: branchId
                    });

                    if (result.deletedCount === 0) {
                        throw new MoleculerError("Failed to delete export", 500, "DELETE_FAILED");
                    }

                    return {
                        success: true,
                        message: "Customer export deleted successfully",
                        data: {
                            deletedId: ctx.params.id
                        }
                    };
                } catch (error) {
                    if (error.name === "CastError" || error.name === "BSONTypeError") {
                        throw new MoleculerError("Invalid export ID format", 400, "INVALID_ID_FORMAT");
                    }
                    throw error;
                }
            }
        },
        bulkDeleteExports: {
            cache: false,
            auth: "required",
            rest: {
                method: "DELETE",
                path: "/bulk-delete"
            },
            params: {
                ids: {
                    type: "array",
                    items: { type: "string" },
                    min: 1
                }
            },
            async handler(ctx) {
                console.log("Bulk deleting exports with IDs:", ctx.params.ids);

                try {
                    const exportIds = ctx.params.ids.map(id => new ObjectId(id));
                    const orgId = new ObjectId(ctx.meta.org_id);
                    const branchId = new ObjectId(ctx.meta.branch_id);

                    // Validate all IDs are valid ObjectIds
                    const invalidIds = ctx.params.ids.filter(id => !ObjectId.isValid(id));
                    if (invalidIds.length > 0) {
                        throw new MoleculerError("Invalid export ID(s)", 400, "INVALID_ID_FORMAT", {
                            invalidIds: invalidIds
                        });
                    }

                    // Find and delete all export records
                    const deleteResult = await this.adapter.model.deleteMany({
                        _id: { $in: exportIds },
                        org_id: orgId,
                        branch_id: branchId
                    });

                    if (deleteResult.deletedCount === 0) {
                        throw new MoleculerError("No export records found to delete", 404, "NO_EXPORTS_FOUND");
                    }

                    // Send notification about bulk deletion
                    try {
                        await ctx.call("notification.send", {
                            templateKey: "bulk_export_delete_completed",
                            variables: {
                                totalRecords: ctx.params.ids.length,
                                deletedCount: deleteResult.deletedCount
                            },
                            additionalData: {
                                organisation_id: ctx.meta.org_id.toString(),
                                user_id: ctx.meta.user_id || "",
                                branch_id: ctx.meta.branch_id.toString()
                            }
                        });
                    } catch (notificationError) {
                        this.logger.error(`Failed to send notification for bulk export delete: ${notificationError.message}`);
                        // Don't fail the main operation if notification fails
                    }

                    return {
                        success: true,
                        message: `Successfully deleted ${deleteResult.deletedCount} out of ${ctx.params.ids.length} export records`,
                        data: {
                            totalRequested: ctx.params.ids.length,
                            deletedCount: deleteResult.deletedCount,
                            failedCount: ctx.params.ids.length - deleteResult.deletedCount
                        }
                    };
                } catch (error) {
                    if (error.name === "CastError" || error.name === "BSONTypeError") {
                        throw new MoleculerError("Invalid export ID format", 400, "INVALID_ID_FORMAT");
                    }
                    throw error;
                }
            }
        },
        startExport: {
            auth: "required",
            params: {
                query: { type: "object", optional: true },
            },
            async handler(ctx) {
                try {
                    const { query } = ctx.params;
                    this.logger.info(`Initiating customer export with query: ${JSON.stringify(query)}`);
                    const result = await ctx.call("exportCsvWorker.customerExport", query);
                    return result;
                } catch (error) {
                    this.logger.error(`Error initiating customer export: ${error.message}`);
                    throw new MoleculerError(`Failed to initiate customer export: ${error.message}`, 500, "EXPORT_INIT_FAILED");
                }
            }
        }
    },
    methods: {
        // Add service methods here if needed
    },
    created() {
        // Lifecycle event handler
    },
    started() {
        // Lifecycle event handler
    },
    stopped() {
        // Lifecycle event handler
    }
};
