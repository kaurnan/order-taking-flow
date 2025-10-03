const DbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const FlowDataRowModel = require("../../models/flow/flowdatarow.model");

"use strict";


module.exports = {
    name: "flowdata",
    mixins: [DbMixin("flow/flowdata")],
    settings: {
        // Add service settings here if needed
    },
    dependencies: [],
    events: {
        // Add event handlers here if needed
    },
    actions: {
        createFlowDataTable: {
            rest: "POST /",
            auth: "required",
            params: {
                flow_id: { type: "string", optional: true },
                title: { type: "string" },
                columns: { type: "array" },
            },
            async handler(ctx) {
                const { flow_id, title, columns } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.insertOne({
                        flow_id: flow_id ?? null,
                        org_id,
                        branch_id,
                        title,
                        columns,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    return {
                        code: "200",
                        success: true,
                        message: "Flow data table created successfully",
                        data: record,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            },
        },
        saveFlowData: {
            rest: "POST /",
            auth: "required",
            params: {
                table_ref: { type: "string" },
                columns: { type: "object" }
            },
            async handler(ctx) {
                const { table_ref, columns } = ctx.params;
                const { branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await FlowDataRowModel.insertOne({
                        table_ref,
                        columns,
                        branch_id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    return {
                        code: "200",
                        success: true,
                        message: "Flow data saved successfully",
                        data: record,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        deleteDataTable: {
            rest: "DELETE /",
            auth: "required",
            params: {
                id: { type: "string", min: 24, max: 24 },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.findByIdAndDelete(id);
                    await FlowDataRowModel.deleteMany({ table_ref: id });
                    return {
                        code: "200",
                        success: true,
                        message: "Flow data table deleted successfully",
                        data: record,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        pinDataTable: {
            rest: "POST /pin",
            auth: "required",
            params: {
                id: { type: "string", min: 24, max: 24 },
                is_pinned: { type: "boolean" }
            },
            async handler(ctx) {
                const { id, is_pinned } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.findByIdAndUpdate(id, { is_pinned }, { new: true });
                    return {
                        code: "200",
                        success: true,
                        message: `Flow data table ${is_pinned ? "pinned" : "unpinned"} successfully`,
                        data: record,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        pinnedDataTables: {
            rest: "GET /pin",
            auth: "required",
            async handler(ctx) {
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const records = await this.adapter.model.find({ org_id, branch_id, is_pinned: true });
                    return {
                        code: "200",
                        success: true,
                        message: "Pinned data tables fetched successfully",
                        data: records,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        flowData: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/flow-data"
            },
            params: {
                table_ref: { type: "string" },
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                search: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { table_ref, pageSize, page, search } = ctx.params;

                const { branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_read") || ctx.meta.scopes.includes("full_control")) {
                    const query = {
                        branch_id: new ObjectId(branch_id),
                        table_ref: new ObjectId(table_ref)
                    };
                    const skip = (parseInt(page) - 1) * parseInt(pageSize);
                    const total = await FlowDataRowModel.countDocuments({ branch_id: new ObjectId(branch_id), table_ref: new ObjectId(table_ref) });
                    if (search) query.name = { $regex: search, $options: "i" };
                    const records = await FlowDataRowModel.find(query).skip(skip).limit(parseInt(pageSize)).sort({ _id: -1 });
                    records.map((record) => {
                        if (record?.columns) {
                            record?.columns.set("date", new Date(record.createdAt).toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "long",
                                day: "numeric"
                            }));
                        }
                    });
                    if (!records || records.length === 0) {
                        console.error("No flow data found for branch ID:", branch_id);
                        throw new MoleculerError("Flow data not found", 404, "FLOW_DATA_NOT_FOUND");
                    }
                    return {
                        success: true,
                        message: "Flow data fetched successfully",
                        data: records,
                        pagination: {
                            total,
                            page: parseInt(page),
                            pageSize,
                            totalPages: Math.ceil(total / pageSize),
                        },
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        flowDataTables: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/flow-data-tables"
            },
            async handler(ctx) {
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_read") || ctx.meta.scopes.includes("full_control")) {
                    const records = await this.adapter.model.find({ org_id: org_id, branch_id: branch_id });
                    return {
                        code: "200",
                        success: true,
                        message: "Flow data tables fetched successfully",
                        data: records,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
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