const DbMixin = require("../../mixins/db.mixin");
const mongoose = require("mongoose");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const { default: axios } = require("axios");
const flowModel = require("../../models/flow/flow.model");
const whatsappTemplateModel = require("../../models/whatsapptemplate.model");
const channelModel = require("../../models/channel.model");

"use strict";

require("dotenv").config();

module.exports = {
    name: "campaign",
    mixins: [DbMixin("flow/campaign")],
    settings: {
        // Add service settings here if needed
    },
    events: {
        // Add event handlers here if needed
    },
    actions: {
        /**
         * Create or update a campaign.
         * If `id` is provided, it updates the existing campaign.
         */
        createUpdate: {
            rest: "POST /",
            auth: "required",
            params: {
                flowIds: { type: "array", optional: true, items: { type: "string" } },
                id: { type: "string", optional: true },
                title: { type: "string", optional: true },
                description: { type: "string", optional: true },
                end_date: { type: "string", optional: true },
                start_date: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { flowIds, id, title, description, end_date, start_date } = ctx.params;
                const org_id = new ObjectId(ctx.meta.org_id);
                const branch_id = new ObjectId(ctx.meta.branch_id);

                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {

                    // Fetch all flows by their IDs
                    const flows = [];
                    if (flowIds) {
                        for (const flowId of flowIds) {
                            const flow = await flowModel.findById(flowId);
                            if (!flow) {
                                throw new MoleculerError(`Flow not found for ID: ${flowId}`, 404, "FLOW_NOT_FOUND");
                            }
                            flows.push(flow);
                        }
                    }

                    if (id) {
                        const existing = await this.adapter.model.findOne({
                            title: title?.trim(),
                            org_id: org_id,
                            branch_id,
                            _id: { $ne: id }
                        });

                        if (existing) {
                            return {
                                code: "400",
                                success: false,
                                message: "Campaign name already exists. Please choose a different name.",
                                data: null
                            };
                        }
                        const existingCampaign = await this.adapter.model.findById(id);
                        if (!existingCampaign) {
                            throw new MoleculerError("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
                        }

                        // Only include flows if flowIds parameter is provided and not empty
                        const updateFields = {
                            title: title ? title.trim() : existingCampaign.title,
                            description: description ?? existingCampaign.description,
                            start_date: start_date ? new Date(start_date) : existingCampaign.start_date,
                            end_date: end_date && end_date !== "Invalid Date" ? new Date(end_date) : existingCampaign.end_date,
                        };
                        if (Array.isArray(flowIds) && flowIds.length > 0) {
                            updateFields.flows = flows;
                        }
                        const campaign = await this.adapter.model.findByIdAndUpdate(
                            id,
                            updateFields,
                            { new: true }
                        );
                        await ctx.broker.cacher.clean("campaign.listCampaigns*");
                        return {
                            code: "200",
                            success: true,
                            message: "Campaign updated successfully",
                            data: campaign,
                        };
                    } else {
                        const alreadyExists = await this.adapter.model.findOne({ title: title?.trim(), branch_id, org_id });
                        if (alreadyExists) {
                            return {
                                code: "400",
                                success: false,
                                message: "Campaign name already exists. Please choose a different name.",
                                data: null,
                            };
                        }
                        const campaign = await this.adapter.insert({
                            title: title?.trim(),
                            description: description ?? "",
                            start_date: start_date ? new Date(start_date) : null,
                            end_date: end_date && end_date !== "Invalid Date" ? new Date(end_date) : null,
                            branch_id: branch_id,
                            flows: flows,
                            org_id: org_id,
                            flow_versions: flows.map(flow => ({
                                id: flow._id,
                                version: flow.version || 1
                            })),
                        });
                        // Use .findById to select fields after insert
                        await ctx.broker.cacher.clean("campaign.listCampaigns*");
                        return {
                            code: "200",
                            success: true,
                            message: "Campaign created successfully",
                            data: campaign,
                        };
                    }
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            },
        },

        /**
         * Publish a campaign by its ID. and update the campaign status to 'Active'.
         */
        publishCampaign: {
            rest: "POST /publish",
            auth: "required",
            params: {
                id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    this.publishCampaign(id);
                    return {
                        success: true,
                        message: "Campaign publish initiated successfully, it will be processed in the background.",
                        data: null,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            },
        },

        /**
         * List all campaigns with pagination and search functionality.
         * @param {string} page - The page number for pagination (default: 1
         */
        listCampaigns: {
            cache: {
                ttl: 30, // Cache for 30 seconds
            },
            auth: "required",
            rest: {
                method: "GET",
                path: "/campaigns"
            },
            params: {
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                search: { type: "string", optional: true },
                status: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { pageSize, page, search, status } = ctx.params;
                const { branch_id, org_id } = ctx.meta;
                const statusList = status ? status.split(",").map(s => s.trim()) : null;
                if (ctx.meta.scopes.includes("flow_read") || ctx.meta.scopes.includes("full_control")) {
                    const query = {
                        org_id: new ObjectId(org_id),
                        branch_id: new ObjectId(branch_id),
                    };
                    if (statusList) {
                        query.status = { $in: statusList };
                    }
                    const skip = (parseInt(page) - 1) * parseInt(pageSize);
                    const total = await this.adapter.model.countDocuments(query);
                    if (search) query.title = { $regex: search, $options: "i" };

                    const campaigns = await this.adapter.model.find(query)
                        .skip(skip)
                        .limit(parseInt(pageSize))
                        .sort({ _id: -1 }).select("-__v")
                        .populate({
                            path: "flows._id",
                            model: "flow",
                            select: "_id title description updatedAt version",
                        });

                    if (!campaigns || campaigns.length === 0) {
                        return {
                            success: true,
                            message: "No campaigns found",
                            data: [],
                            pagination: {
                                total: 0,
                                page: parseInt(page),
                                pageSize: parseInt(pageSize),
                                totalPages: 0,
                            },
                        };
                    }

                    const formattedCampaigns = await Promise.all(campaigns.map(async campaign => {
                        let campaignObj = campaign.toObject();
                        // For each flow, collect errors specific to that flow
                        campaignObj.flows = await Promise.all(
                            campaignObj.flows.map(async flowObj => {
                                let flowErrors = [];
                                const feFlow = flowObj.fe_flow;
                                if (feFlow && Array.isArray(feFlow.nodes)) {
                                    // Collect unique template/channel pairs for this flow
                                    const whatsappTemplateIds = [];
                                    feFlow.nodes.forEach(node => {
                                        if (node.type === "whatsappNode") {
                                            const templateId = node.data?.form_payload?.template_id;
                                            if (templateId && !whatsappTemplateIds.some(t => t.templateId === templateId && t.channelId === flowObj.channel?.toString())) {
                                                whatsappTemplateIds.push({ templateId: templateId, channelId: flowObj.channel?.toString() });
                                            }
                                        }
                                    });
                                    if (whatsappTemplateIds.length > 0) {
                                        const templateChecks = await Promise.all(
                                            whatsappTemplateIds.map(async ({ templateId, channelId }) => {
                                                if (!mongoose.Types.ObjectId.isValid(templateId)) {
                                                    return `Invalid template ID: ${templateId}`;
                                                }
                                                // Fetch template and channel in parallel
                                                const [template, channel] = await Promise.all([
                                                    whatsappTemplateModel.findById(templateId),
                                                    channelModel.findById(channelId)
                                                ]);
                                                if (template && channel) {
                                                    const metaTemplate = template.meta_templates.find(
                                                        mt => mt.waba_id?.toString() === channel.waba_id?.toString()
                                                    );
                                                    if (metaTemplate && metaTemplate.status !== "APPROVED") {
                                                        return `Template: ${template.name} is not Approved for this channel ${channel.waba_id}. Status: ${metaTemplate.status}`;
                                                    }
                                                }
                                                return null;
                                            })
                                        );
                                        templateChecks.forEach(err => {
                                            if (err && !flowErrors.includes(err)) flowErrors.push(err);
                                        });
                                    }
                                }
                                return { ...flowObj, errors: flowErrors, update_available: flowObj?.version < (flowObj._id.version || 1), new_version: flowObj._id?.version || 1 };
                            })
                        );
                        return campaignObj;
                    }));

                    return {
                        success: true,
                        message: "Campaigns fetched successfully",
                        data: formattedCampaigns,
                        pagination: {
                            total,
                            page: parseInt(page),
                            pageSize: parseInt(pageSize),
                            totalPages: Math.ceil(total / pageSize),
                        },
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        /**
         * Delete a campaign by ID.
         * @param {string} id - The ID of the campaign to delete.
         */
        delete: {
            rest: "DELETE /",
            auth: "required",
            params: {
                id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const record = await this.adapter.model.findByIdAndDelete(id);
                    if (!record) {
                        throw new MoleculerError("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
                    }
                    return {
                        success: true,
                        message: "Campaign deleted successfully",
                        data: null,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        /**
         * Change the status of a campaign.
         * @param {string} id - The ID of the campaign.
         */
        ChangeCampaignStatus: {
            rest: "PUT /changeStatus",
            auth: "required",
            params: {
                id: { type: "string", required: true },
                status: { type: "string", required: true, enum: ["Draft", "Paused", "Active"] }
            },
            async handler(ctx) {
                const { id, status } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const campaign = await this.adapter.model.findById(id);
                    if (!campaign) {
                        throw new MoleculerError("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
                    }
                    campaign.status = status;
                    const updatedCampaign = await campaign.save();
                    return {
                        code: "200",
                        success: true,
                        message: "Campaign status updated successfully",
                        data: updatedCampaign,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        /**
         * Change the status of a flow within a campaign.
         * @param {string} id - The ID of the campaign.
         */
        changeCampFlowStatus: {
            rest: "PUT /changeFlowStatus",
            auth: "required",
            params: {
                id: { type: "string", required: true },
                flowId: { type: "string", required: true },
                status: { type: "string", required: true, enum: ["Draft", "Active"] }
            },
            async handler(ctx) {
                const { id, flowId, status } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const campaign = await this.adapter.model.findById(id);
                    if (!campaign) {
                        throw new MoleculerError("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
                    }
                    const flow = campaign.flows.find(f => f._id.toString() === flowId);
                    if (!flow) {
                        throw new MoleculerError("Flow not found in campaign", 404, "FLOW_NOT_FOUND");
                    }
                    flow.status = status;
                    campaign.markModified("flows");
                    const updatedCampaign = await campaign.save();
                    return {
                        code: "200",
                        success: true,
                        message: "Flow status updated successfully",
                        data: updatedCampaign,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        updateToLatestVersion: {
            rest: "POST /updateToLatestVersion",
            auth: "required",
            params: {
                id: { type: "string", required: true },
                flow_id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { id, flow_id } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const campaign = await this.adapter.model.findById(id);
                    if (!campaign) {
                        throw new MoleculerError("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
                    }
                    // Fetch latest versions of all flows in the campaign
                    const updatedFlows = [];
                    for (const flowObj of campaign.flows || []) {
                        const flowId = flowObj._id?.toString();
                        if (!flowId) continue;
                        const flowRes = await ctx.call("flow.getFlowById", { id: flowId });
                        if (!flowRes || !flowRes.data) {
                            throw new MoleculerError(`Flow not found for ID: ${flowId}`, 404, "FLOW_NOT_FOUND");
                        }
                        updatedFlows.push(flowRes.data);
                    }
                    // Update campaign with latest flows and trigger_topic from first flow
                    const updatedCampaign = await this.adapter.model.findByIdAndUpdate(
                        id,
                        {
                            flows: updatedFlows,
                            trigger_topic: updatedFlows[0]?.fe_flow?.nodes[0].data?.topic ?? "",
                        },
                        { new: true }
                    );
                    this.publishFlow(id, flow_id).catch(err => {
                        console.error("Error publishing flow:", err);
                    });
                    return {
                        code: "200",
                        success: true,
                        message: "flow updated to latest version successfully",
                        data: updatedCampaign,
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        }
    },
    methods: {
        publishCampaign: async function (campaignId) {
            try {
                const response = await axios.post(
                    process.env.PUBLISH_URL,
                    { id: campaignId }
                );
                console.log("Campaign published successfully:", response.data);
                return response.data;
            } catch (error) {
                throw new MoleculerError("Failed to publish campaign", 500, "PUBLISH_ERROR", error);
            }
        },
        publishFlow: async function (campaignId, flowId) {
            try {
                const response = await axios.post(
                    `${process.env.PUBLISH_URL}/by_flow_id`,
                    { id: campaignId, flow_id: flowId }
                );
                console.log("Flow published successfully:", response.data);
                return response.data;
            } catch (error) {
                throw new MoleculerError("Failed to publish flow by flow ID", 500, "PUBLISH_ERROR", error);
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