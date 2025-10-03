const DbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const profileExportQueue = require("../../queues/profile-export.queue");
const customerModel = require("../../models/customer.model");
const tagModel = require("../../models/tag.model");
const listModel = require("../../models/list.model");

"use strict";

module.exports = {
    name: "profileexport",
    mixins: [DbMixin("profileexport")],
    settings: {
        // Service settings
    },
    events: {
        // Event handlers
    },
    actions: {
        /**
         * Initiate a profile export for audience data
         * @param {object} query - Query parameters to filter customers
         * @param {string} exportType - Type of export (csv, json, xlsx)
         * @param {array} fields - Specific fields to export
         * @param {string} title - Export title
         */
        initiateProfileExport: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/profile-export"
            },
            params: {
                query: { type: "object", optional: true, default: {} },
                exportType: { type: "string", optional: true, default: "csv", enum: ["csv", "json", "xlsx"] },
                fields: { type: "array", optional: true },
                title: { type: "string", optional: true },
                includeTags: { type: "boolean", optional: true, default: true },
                includeLists: { type: "boolean", optional: true, default: true },
                includeMetadata: { type: "boolean", optional: true, default: true }
            },
            async handler(ctx) {
                try {
                    const { query, exportType, fields, title, includeTags, includeLists, includeMetadata } = ctx.params;
                    const orgId = new ObjectId(ctx.meta.org_id);
                    const branchId = new ObjectId(ctx.meta.branch_id);

                    // Build the export query
                    const exportQuery = {
                        ...query,
                        org_id: orgId,
                        branch_id: branchId
                    };

                    // Get customer count for validation
                    const customerCount = await ctx.call("customer.Getcount", { query: exportQuery });

                    if (customerCount === 0) {
                        throw new MoleculerError("No customers found matching the criteria", 400, "NO_CUSTOMERS_FOUND");
                    }

                    // Create export record
                    const exportRecord = {
                        org_id: orgId,
                        branch_id: branchId,
                        query: exportQuery,
                        export_type: exportType,
                        fields: fields || this.getDefaultFields(includeTags, includeLists, includeMetadata),
                        title: title || `Profile Export ${new Date().toISOString().split('T')[0]}`,
                        status: "pending",
                        customer_count: customerCount,
                        include_tags: includeTags,
                        include_lists: includeLists,
                        include_metadata: includeMetadata,
                        created_by: ctx.meta.user_id,
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    const savedExport = await this.adapter.model.create(exportRecord);

                    // Queue the export job to BullMQ
                    const job = await profileExportQueue.add("profile-export", {
                        exportId: savedExport._id.toString(),
                        query: exportQuery,
                        exportType,
                        fields: exportRecord.fields,
                        title: exportRecord.title,
                        includeTags,
                        includeLists,
                        includeMetadata,
                        orgId: orgId.toString(),
                        branchId: branchId.toString(),
                        userId: ctx.meta.user_id
                    }, {
                        removeOnComplete: true,
                        removeOnFail: false
                    });

                    console.log(`Profile export job ${job.id} queued successfully`);

                    return {
                        code: "200",
                        success: true,
                        message: "Profile export initiated successfully",
                        data: {
                            exportId: savedExport._id,
                            status: "pending",
                            customerCount,
                            estimatedTime: this.estimateExportTime(customerCount, exportType)
                        }
                    };
                } catch (error) {
                    this.logger.error("Profile export initiation failed:", error);
                    throw new MoleculerError(
                        error.message || "Failed to initiate profile export",
                        error.code || 500,
                        error.type || "EXPORT_INITIATION_FAILED"
                    );
                }
            }
        },

        /**
         * Get export status and details
         * @param {string} exportId - Export ID
         */
        getExportStatus: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/profile-export/:exportId"
            },
            params: {
                exportId: "string"
            },
            async handler(ctx) {
                try {
                    const { exportId } = ctx.params;
                    const orgId = new ObjectId(ctx.meta.org_id);
                    const branchId = new ObjectId(ctx.meta.branch_id);

                    const exportRecord = await this.adapter.model.findOne({
                        _id: new ObjectId(exportId),
                        org_id: orgId,
                        branch_id: branchId
                    });

                    if (!exportRecord) {
                        throw new MoleculerError("Export not found", 404, "EXPORT_NOT_FOUND");
                    }

                    return {
                        code: "200",
                        success: true,
                        message: "Export status retrieved successfully",
                        data: exportRecord
                    };
                } catch (error) {
                    this.logger.error("Failed to get export status:", error);
                    throw new MoleculerError(
                        error.message || "Failed to get export status",
                        error.code || 500,
                        error.type || "EXPORT_STATUS_FAILED"
                    );
                }
            }
        },

        /**
         * List all profile exports for the organization
         */
        listProfileExports: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/profile-exports"
            },
            params: {
                page: { type: "number", integer: true, min: 1, optional: true, convert: true, default: 1 },
                pageSize: { type: "number", integer: true, min: 1, max: 100, optional: true, convert: true, default: 10 },
                status: { type: "string", optional: true, enum: ["pending", "processing", "completed", "failed"] },
                search: { type: "string", optional: true, trim: true }
            },
            async handler(ctx) {
                try {
                    const { page, pageSize, status, search } = ctx.params;
                    const orgId = new ObjectId(ctx.meta.org_id);
                    const branchId = new ObjectId(ctx.meta.branch_id);

                    const skip = (page - 1) * pageSize;

                    const query = {
                        org_id: orgId,
                        branch_id: branchId
                    };

                    if (status) {
                        query.status = status;
                    }

                    if (search) {
                        const searchRegex = new RegExp(search, "i");
                        query.$or = [
                            { title: searchRegex }
                        ];
                    }

                    const [exports, total] = await Promise.all([
                        this.adapter.model.find(query)
                            .sort({ created_at: -1 })
                            .skip(skip)
                            .limit(pageSize),
                        this.adapter.model.countDocuments(query)
                    ]);

                    return {
                        code: "200",
                        success: true,
                        message: "Profile exports retrieved successfully",
                        data: exports,
                        pagination: {
                            page,
                            pageSize,
                            total,
                            totalPages: Math.ceil(total / pageSize)
                        }
                    };
                } catch (error) {
                    this.logger.error("Failed to list profile exports:", error);
                    throw new MoleculerError(
                        error.message || "Failed to list profile exports",
                        error.code || 500,
                        error.type || "EXPORT_LIST_FAILED"
                    );
                }
            }
        },

        /**
         * Export a single customer profile by ID
         * @param {string} customerId - Customer ID to export
         * @param {string} exportType - Type of export (csv, json, xlsx)
         * @param {array} fields - Specific fields to export
         * @param {string} title - Export title
         */
        exportProfileById: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/profile-export-by-id"
            },
            params: {
                customerId: { type: "string", min: 1 },
                exportType: { type: "string", optional: true, default: "json", enum: ["csv", "json", "xlsx"] },
                fields: { type: "array", optional: true },
                title: { type: "string", optional: true },
                includeTags: { type: "boolean", optional: true, default: true },
                includeLists: { type: "boolean", optional: true, default: true },
                includeMetadata: { type: "boolean", optional: true, default: true }
            },
            async handler(ctx) {
                try {
                    const { customerId, exportType, fields, title, includeTags, includeLists, includeMetadata } = ctx.params;
                    const orgId = new ObjectId(ctx.meta.org_id);
                    const branchId = new ObjectId(ctx.meta.branch_id);

                    // Validate customer exists and belongs to the organization using direct model access
                    const customer = await customerModel.findOne({
                        _id: new ObjectId(customerId),
                        org_id: orgId,
                        branch_id: branchId
                    }).populate({
                        path: "tags",
                        model: tagModel,
                        select: "name"
                    }).populate({
                        path: "lists",
                        model: listModel,
                        select: "title"
                    });

                    if (!customer) {
                        throw new MoleculerError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
                    }

                    // Build the export query for single customer
                    const exportQuery = {
                        _id: new ObjectId(customerId),
                        org_id: orgId,
                        branch_id: branchId
                    };

                    // Create export record
                    const exportRecord = {
                        org_id: orgId,
                        branch_id: branchId,
                        query: exportQuery,
                        export_type: exportType,
                        fields: fields || this.getDefaultFields(includeTags, includeLists, includeMetadata),
                        title: title || `Profile Export - ${customer.name || customer.email || customerId}`,
                        status: "pending",
                        customer_count: 1,
                        include_tags: includeTags,
                        include_lists: includeLists,
                        include_metadata: includeMetadata,
                        created_by: ctx.meta.user_id,
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    const savedExport = await this.adapter.model.create(exportRecord);

                    // Queue the export job to BullMQ
                    const job = await profileExportQueue.add("profile-export", {
                        exportId: savedExport._id.toString(),
                        query: exportQuery,
                        exportType,
                        fields: exportRecord.fields,
                        title: exportRecord.title,
                        includeTags,
                        includeLists,
                        includeMetadata,
                        orgId: orgId.toString(),
                        branchId: branchId.toString(),
                        userId: ctx.meta.user_id
                    }, {
                        removeOnComplete: true,
                        removeOnFail: false
                    });

                    console.log(`Profile export job ${job.id} queued successfully`);

                    return {
                        code: "200",
                        success: true,
                        message: "Profile export initiated successfully",
                        data: {
                            exportId: savedExport._id,
                            status: "pending",
                            customerCount: 1,
                            customerName: customer.name || customer.email || customerId,
                            estimatedTime: "30-60 seconds"
                        }
                    };
                } catch (error) {
                    this.logger.error("Profile export by ID failed:", error);
                    throw new MoleculerError(
                        error.message || "Failed to export profile by ID",
                        error.code || 500,
                        error.type || "EXPORT_BY_ID_FAILED"
                    );
                }
            }
        },

        /**
         * Cancel a pending export
         * @param {string} exportId - Export ID
         */
        cancelExport: {
            auth: "required",
            rest: {
                method: "DELETE",
                path: "/profile-export/:exportId"
            },
            params: {
                exportId: "string"
            },
            async handler(ctx) {
                try {
                    const { exportId } = ctx.params;
                    const orgId = new ObjectId(ctx.meta.org_id);
                    const branchId = new ObjectId(ctx.meta.branch_id);

                    const exportRecord = await this.adapter.model.findOne({
                        _id: new ObjectId(exportId),
                        org_id: orgId,
                        branch_id: branchId,
                        status: { $in: ["pending", "processing"] }
                    });

                    if (!exportRecord) {
                        throw new MoleculerError("Export not found or cannot be cancelled", 404, "EXPORT_NOT_FOUND");
                    }

                    await this.adapter.model.updateOne(
                        { _id: new ObjectId(exportId) },
                        {
                            status: "cancelled",
                            updated_at: new Date()
                        }
                    );

                    return {
                        code: "200",
                        success: true,
                        message: "Export cancelled successfully"
                    };
                } catch (error) {
                    this.logger.error("Failed to cancel export:", error);
                    throw new MoleculerError(
                        error.message || "Failed to cancel export",
                        error.code || 500,
                        error.type || "EXPORT_CANCELLATION_FAILED"
                    );
                }
            }
        }
    },
    methods: {
        /**
         * Get default fields for export based on options
         */
        getDefaultFields(includeTags = true, includeLists = true, includeMetadata = true) {
            const baseFields = [
                "_id",
                "name",
                "email",
                "phone",
                "country",
                "state",
                "note",
                "verified_email",
                "email_marketing_consent",
                "sms_marketing_consent",
                "whatsapp_marketing_consent",
                "created_at",
                "updated_at"
            ];

            if (includeTags) {
                baseFields.push("tags");
            }

            if (includeLists) {
                baseFields.push("lists");
            }

            if (includeMetadata) {
                baseFields.push("meta");
            }

            return baseFields;
        },

        /**
         * Estimate export time based on customer count and export type
         */
        estimateExportTime(customerCount, exportType) {
            const baseTimePerCustomer = 0.001; // seconds per customer
            const typeMultiplier = {
                csv: 1,
                json: 1.2,
                xlsx: 1.5
            };

            const estimatedSeconds = customerCount * baseTimePerCustomer * typeMultiplier[exportType];

            if (estimatedSeconds < 60) {
                return `${Math.ceil(estimatedSeconds)} seconds`;
            } else if (estimatedSeconds < 3600) {
                return `${Math.ceil(estimatedSeconds / 60)} minutes`;
            } else {
                return `${Math.ceil(estimatedSeconds / 3600)} hours`;
            }
        }
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