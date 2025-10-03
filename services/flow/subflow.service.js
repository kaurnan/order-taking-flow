const DbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const { default: axios } = require("axios");

"use strict";


module.exports = {
    name: "subflow",
    mixins: [DbMixin("flow/subflow")],
    settings: {
        // Add service settings here if needed
    },
    dependencies: [],
    events: {
        // Add event handlers here if needed
    },
    actions: {
        create: {
            rest: "POST /",
            auth: "required",
            params: {
                pflow_id: { type: "string", required: true },
                rflow_def: { type: "object", required: true },
                title: { type: "string", required: true },
                description: { type: "string", required: true },
            },
            async handler(ctx) {
                const { pflow_id, rflow_def, title, description } = ctx.params;
                const branch_id = new ObjectId(ctx.meta.branch_id);
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    try {
                        const record = await this.adapter.insert({ pflow_id, rflow_def, title, description, branch_id });
                        return {
                            code: "200",
                            success: true,
                            message: "Subflow created successfully",
                            data: record,
                        };
                    } catch (error) {
                        // Check for duplicate key error (MongoDB error code 11000)
                        if (error.code === 11000) {
                            return {
                                code: "409",
                                success: false,
                                message: "Subflow name is already taken",
                                details: error.keyValue, // Include duplicate key details
                            };
                        }

                        // Handle other potential errors
                        console.error("Error creating subflow:", error);
                        return {
                            code: "500",
                            success: false,
                            message: "An error occurred while creating the subflow",
                            details: error.message,
                        };
                    }
                } else {
                    throw new MoleculerError("You do not have permission to create a subflow", 403, "FORBIDDEN");
                }
            },
        },
        update: {
            rest: "PUT /",
            auth: "required",
            params: {
                id: { type: "string", required: true },
                title: { type: "string", optional: true },
                description: { type: "string", optional: true },
                rflow_def: { type: "object", optional: true },
            },
            async handler(ctx) {
                const { id, title, description, rflow_def } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.findByIdAndUpdate(
                        id,
                        {
                            title,
                            description,
                            rflow_def,
                        },
                        { new: true }
                    );
                    const subflow = await this.adapter.findById(id);
                    subflow?.rflow_def?.nodes.map(async (node) => {
                        if (node?.type === "subflowOutputNode") {
                            let subflowouput = node.data.payload;
                            let response = await ctx.call("flow.getFlowById", { id: subflow.pflow_id.toString() });
                            let mainflow = response?.data;
                            let nodes = mainflow?.fe_flow?.nodes;
                            nodes
                                ?.filter((mnode) => mnode.type === "subflowNode" && mnode.data.subflow === id)
                                .map((mainnode) => {
                                    mainnode.data.sample_payload = subflowouput;
                                    console.log("mainnode sample payload", mainnode.data.sample_payload);
                                });
                            console.log("after nodes filter :", nodes);
                            await ctx.call("flow.update", {
                                _id: subflow.pflow_id,
                                fe_flow: { nodes }
                            });
                        }
                    });
                    return {
                        code: "200",
                        success: true,
                        message: "Subflow updated successfully",
                        data: record,
                    };
                } else {
                    throw new MoleculerError("You do not have permission to update this subflow", 403, "FORBIDDEN");
                }
            },
        },
        listSubflowsByFlowId: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/subflows"
            },
            params: {
                pflow_id: { type: "string", min: 24, max: 24 },
            },
            async handler(ctx) {
                const { pflow_id } = ctx.params;
                console.log("Fetching subflows for parent flow ID:", pflow_id);
                if (["flow_read", "full_control", "flow_write"].some(scope => ctx.meta.scopes.includes(scope))) {
                    const records = await this.adapter.model.find({ pflow_id: new ObjectId(pflow_id) });
                    return {
                        code: "200",
                        success: true,
                        message: "Subflows fetched successfully",
                        data: records,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        publishSubflow: {
            rest: "POST /publish",
            auth: "required",
            params: {
                id: { type: "string", required: true },
                pflow_id: { type: "string", required: true },
                org_id: { type: "string", required: true },
                branch_id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { id, pflow_id, org_id, branch_id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    this.publishSubflow(id, pflow_id, org_id, branch_id);
                    return {
                        code: "200",
                        success: true,
                        message: "Subflow published successfully",
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            },
        },
        delete: {
            rest: "DELETE /",
            auth: "required",
            params: {
                id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.findOneAndDelete({ _id: id, branch_id: new ObjectId(ctx.meta.branch_id) });
                    if (!record) {
                        throw new MoleculerError("Subflow not found", 404, "SUBFLOW_NOT_FOUND");
                    }
                    return {
                        code: "200",
                        success: true,
                        message: "Subflow deleted successfully",
                        data: record,
                    };
                } else {
                    throw new MoleculerError("You do not have permission to delete this subflow", 403, "FORBIDDEN");
                }
            },
        },
        deleteSubflowsByFlowId: {
            rest: "DELETE /by-flow",
            auth: "required",
            params: {
                pflow_id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { pflow_id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const result = await this.adapter.model.deleteMany({ pflow_id });
                    return {
                        code: "200",
                        success: true,
                        message: "Subflows deleted successfully",
                        data: result,
                    };
                } else {
                    throw new MoleculerError("You do not have permission to delete these subflows", 403, "FORBIDDEN");
                }
            },
        },
    },
    methods: {
        async publishSubflow(subflowId, pflowId, orgId, branchId) {
            try {
                await axios.post(
                    process.env.PUBLISH_URL_SUBFLOW,
                    { id: subflowId, pflow_id: pflowId, org_id: orgId, branch_id: branchId }
                );
            } catch (error) {
                console.error("Error publishing subflow:", error);
                // throw new MoleculerError("Failed to publish subflow", 500, "PUBLISH_ERROR");
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