const DbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const channel = require("../../models/channel.model");

"use strict";


module.exports = {
    name: "flow",
    mixins: [DbMixin("flow/flow")],
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
                title: { type: "string", min: 1, max: 100 },
                description: { type: "string", optional: true, max: 500 },
                channel: { type: "string" },
            },
            async handler(ctx) {
                const { title, description, channel } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const channelDoc = await ctx.call("channel.getChannel", { id: channel });
                    if (!channelDoc) {
                        throw new MoleculerError("Channel not found", 404, "CHANNEL_NOT_FOUND");
                    }
                    console.log(ctx.meta);
                    const flow = await this.adapter.findOne({ title, branch_id, org_id });
                    if (!flow) {
                        const record = await this.adapter.insert({
                            title,
                            description: description || "",
                            channel: new ObjectId(channel),
                            org_id,
                            branch_id,
                        });
                        ctx.call("flow_stats.create", {
                            flow_id: record._id.toString(),
                            org_id: org_id.toString(),
                            branch_id: branch_id.toString(),
                        }).then(res => {
                            console.log("Flow stats created successfully", res);
                        }).catch(err => {
                            console.error("Failed to create flow stats", err);
                        });
                        ctx.call("pubsub.createTopic", {
                            topic_name: `flow_${record._id.toString()}`,
                        }).then(res => {
                            console.log("PubSub topic created successfully", res);
                        }).catch(err => {
                            console.error("Failed to create PubSub topic", err);
                        });
                        return {
                            code: "200",
                            success: true,
                            message: "Flow created successfully",
                            data: record,
                        };
                    } else {
                        return {
                            code: "409",
                            success: false,
                            message: "Flow creation failed due to duplicate title",
                        };
                    }
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            },
        },
        updateFlow: {
            rest: "PUT /",
            auth: "required",
            params: {
                _id: { type: "string" },
                title: { type: "string", min: 1, max: 100 },
                description: { type: "string", optional: true, max: 500 },
                fe_flow: { type: "object", optional: true }, // Frontend flow definition
            },
            async handler(ctx) {
                const { _id, title, description, fe_flow } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.findByIdAndUpdate(
                        _id,
                        {
                            title,
                            description,
                            fe_flow
                        },
                        { new: true }
                    );
                    return {
                        code: "200",
                        success: true,
                        message: "Flow updated successfully",
                        data: record,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        listFlows: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/flows"
            },
            params: {
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                search: { type: "string", optional: true },
                trigger: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { pageSize, page, search, trigger } = ctx.params;

                const { branch_id, org_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_read") || ctx.meta.scopes.includes("full_control")) {
                    const query = {
                        org_id: new ObjectId(org_id),
                        branch_id: new ObjectId(branch_id),
                    };
                    if (trigger) {
                        query["fe_flow.nodes.0.data.topic"] = trigger;
                    }
                    const skip = (parseInt(page) - 1) * parseInt(pageSize);
                    const total = await this.adapter.model.countDocuments({ org_id: new ObjectId(org_id), branch_id: new ObjectId(branch_id) });
                    if (search) query.name = { $regex: search, $options: "i" };
                    const flows = await this.adapter.model.find(query).populate({
                        path: "channel",
                        model: channel,
                        select: "phone_number_details.display_phone_number profile_picture_url waba_id phone_number_details.verified_name",
                    }).skip(skip).limit(parseInt(pageSize)).sort({ _id: -1 });
                    if (!flows || flows.length === 0) {
                        throw new MoleculerError("Flows not found", 404, "FLOWS_NOT_FOUND");
                    }
                    return {
                        success: true,
                        message: "Flows fetched successfully",
                        data: flows,
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
        getFlowById: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/flow"
            },
            params: {
                id: { type: "string", min: 24, max: 24 },
                is_default: { type: "boolean", optional: true, default: false }
            },
            async handler(ctx) {
                const { id, is_default } = ctx.params;
                console.log("Fetching flow for ID:", id);
                if (ctx.meta.scopes.includes("flow_read") || ctx.meta.scopes.includes("full_control")) {
                    if (is_default) {
                        const record = await ctx.call("default_flows.getDefaultFlow", { id });
                        return {
                            code: "200",
                            success: true,
                            message: "Default flow fetched successfully",
                            data: record,
                        };
                    } else {
                        const record = await this.adapter.findOne({ _id: new ObjectId(id) });
                        return {
                            code: "200",
                            success: true,
                            message: "Flow fetched successfully",
                            data: record,
                        };
                    }
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        deleteFlow: {
            rest: "DELETE /",
            auth: "required",
            params: {
                id: { type: "string", min: 24, max: 24 },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.findByIdAndDelete(id);
                    if (!record) {
                        throw new MoleculerError("Flow not found", 404, "FLOW_NOT_FOUND");
                    }
                    await ctx.call("flow_stats.delete", {
                        flow_id: id,
                        org_id: ctx.meta.org_id,
                        branch_id: ctx.meta.branch_id,
                    });
                    await ctx.call("subflow.deleteSubflowsByFlowId", {
                        pflow_id: id
                    });
                    return {
                        code: "200",
                        success: true,
                        message: "Flow deleted successfully",
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