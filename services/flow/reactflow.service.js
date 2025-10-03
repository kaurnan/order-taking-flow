const dbMixin = require("../../mixins/db.mixin");
const mongoose = require("mongoose");
const flowModel = require("../../models/flow/flow.model");
const flowListingModel = require("../../models/flowstore/flows.model");
const listModel = require("../../models/flowstore/list.model");
const FlowData = require("../../models/flow/flowdata.model");
const { MoleculerError } = require("moleculer").Errors;

"use strict";

module.exports = {
    name: "reactflow",
    mixins: [dbMixin("flowstore/reactflow")],
    actions: {
        installFlow: {
            rest: "POST /install",
            auth: "required",
            params: {
                handle: { type: "string", required: true },
            },
            async handler(ctx) {
                const { handle } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    const newObjectId = new mongoose.Types.ObjectId();
                    console.log("newObjectId", newObjectId);
                    const Channel_response = await ctx.call("channel.getChannels");
                    const channel = Channel_response?.data[0];
                    console.log("channel", channel);
                    const list = await listModel.findOne({ handle: handle });
                    if (!list) {
                        return {
                            code: "400",
                            success: false,
                            message: "Flowstore for handle not found! Please contact support team",
                            data: null,
                        };
                    }
                    const FlowstoreFlow = await flowListingModel.findOne({ listing_id: new mongoose.Types.ObjectId(list._id) });
                    console.log("FlowstoreFlow", FlowstoreFlow);
                    if (!FlowstoreFlow) {
                        return {
                            code: "400",
                            success: false,
                            message: "Flowstore automation not found! Please contact support team",
                            data: null,
                        };
                    }
                    if (!FlowstoreFlow?.templates) {
                        return {
                            code: "400",
                            success: false,
                            message: "Automation templates not found! Please contact support team",
                            data: null,
                        };
                    }
                    const mainFlow_response = await this.adapter.model.findOne({ _id: FlowstoreFlow.mflow });
                    console.log("mainFlow_response", mainFlow_response);
                    let mflow = mainFlow_response;
                    console.log("mflow", mflow);
                    const randomFourDigit = Math.floor(1000 + Math.random() * 9000);
                    let mainFlow = {
                        _id: newObjectId,
                        title: `${mflow.title}-${randomFourDigit}`,
                        description: mflow.desc,
                        fe_flow: {
                            nodes: mflow.nodes,
                            edges: mflow.edges,
                        },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        org_id: org_id,
                        branch_id: branch_id,
                        channel: channel?._id ?? "",
                        flowstore_ref: FlowstoreFlow._id,
                        status: "Installing"
                    };

                    const record = await flowModel.insertOne(mainFlow);
                    console.log("created flow", record);
                    const date = new Date();
                    const campaign = await ctx.call("campaign.createUpdate", { flowIds: [newObjectId.toString()], title: `${mflow.title}-${randomFourDigit}`, description: mflow.desc, start_date: date.toISOString(), end_date: date.toISOString() });
                    console.log("campaign", campaign);
                    let campaignObj = campaign?.data;
                    campaignObj.flow_versions = [{
                        id: newObjectId.toString(),
                        version: 1,
                        update_available: false,
                    }];
                    // template creation and update template ids in mainflow and subflows
                    this.installFlowStart(ctx, branch_id, org_id, FlowstoreFlow, newObjectId, campaign?.data?._id.toString(), randomFourDigit);


                    return {
                        code: "200",
                        success: true,
                        message: "Automation installed successfully",
                        data: campaignObj,
                    };

                } else {
                    throw new MoleculerError("Unauthorized", 403, "UNAUTHORIZED");
                }
            }
        }
    },
    methods: {
        async publishSubflow(ctx, createdChildFlows, branch_id, org_id, mflow) {
            try {
                await Promise.all(
                    createdChildFlows?.map(async (childFlow) => {
                        try {
                            await ctx.call("subflow.publishSubflow", {
                                id: childFlow._id.toString(),
                                branch_id,
                                org_id,
                                pflow_id: mflow._id.toString(),
                                title: childFlow.title,
                                description: childFlow.description,
                                rflow_def: childFlow.rflow_def
                            });
                        } catch (err) {
                            console.error(`Failed to publish subflow ${childFlow._id}:`, err);
                        }
                    })
                );
            } catch (error) {
                console.error("Error in publishSubflow:", error);
            }
        },
        async installFlowStart(ctx, branch_id, org_id, FlowstoreFlow, newObjectId, campaignId, randomFourDigit) {
            const query = {
                _id: { $in: FlowstoreFlow.templates.map((template) => mongoose.Types.ObjectId.isValid(template.id) ? new mongoose.Types.ObjectId(template.id) : template.id) },
            };
            console.log("query", JSON.stringify(query));
            const templates_response = await ctx.call("flowstore_template.listTemplates", { query });
            let templates = templates_response.data;
            let templates_new = [];
            console.log("templates", templates);

            for (let template of templates) {
                const randomId = Date.now() % 1000;
                const newTemplateName = `${template.name}_${randomId}`;

                const templatePayload = {
                    name: newTemplateName,
                    category: template.category,
                    language: template.language,
                    components: template.components,
                };

                try {
                    const createdTemplate_response = await ctx.call("whatsapp.createTemplate", templatePayload);
                    console.log("createdTemplate", createdTemplate_response?.data);
                    template.id = createdTemplate_response.data?._id;
                    template.name = newTemplateName;
                    template.meta_templates = createdTemplate_response.data?.meta_templates || [];
                    templates_new.push({
                        _id: template._id,
                        category: template.category,
                        language: template.language,
                        components: template.components,
                        id: createdTemplate_response.data?._id,
                        name: newTemplateName,
                        meta_templates: createdTemplate_response.data?.meta_templates || [],
                    });
                } catch (error) {
                    console.error(`Error creating template: ${template.name}`, JSON.stringify(error));
                }
            }

            if (templates.every((template) => template.id === null)) {
                console.error("Failed to create any templates");
            }

            try {
                const mainFlow_response = await this.adapter.model.findOne({ _id: FlowstoreFlow.mflow });
                let mflow = mainFlow_response;
                let sflows = FlowstoreFlow?.sflows;
                console.log("sflows", sflows);
                let outcome = FlowstoreFlow?.outcome;
                let outcome_id = null;
                if (outcome?.columns && outcome.columns.length > 0) {
                    const SaveTablerecord = await FlowData.insertOne({
                        org_id: org_id,
                        branch_id,
                        title: outcome.name,
                        columns: outcome.columns,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    outcome_id = SaveTablerecord?.id;
                    console.log(SaveTablerecord.id);
                }
                for (const subflow of sflows) {
                    const subflow_response = await this.adapter.model.findOne({ _id: subflow });
                    console.log("subflow_response", subflow_response);
                    let nodes = subflow_response.nodes.map((node) => {
                        if (node.type === "saveDataNode") {
                            node.data.table = outcome_id;
                        }
                        if (node.type === "whatsappNode") {
                            let item = templates_new.find((template) => template.name.split("_")[0] === node.data.meta_payload.name);
                            console.log("template details:", item);
                            node.data.meta_payload.name = item?.name;
                            node.data.form_payload.template_id = item?.id.toString();
                            node.data.form_payload.template.name = item?.name;
                            node.data.form_payload.template.id = item?.id.toString();
                        }
                        return node;
                    });
                    let edges = subflow_response.edges;
                    console.log("mainflowID", mflow._id);
                    let subflowData = {
                        title: subflow_response.title,
                        pflow_id: newObjectId.toString(),
                        description: subflow_response.desc,
                        rflow_def: {
                            nodes: nodes,
                            edges: edges,
                        }
                    };
                    const record = await ctx.call("subflow.create", subflowData);
                    console.log("created subflow", record);
                }
                let createdChildFlows_response = await ctx.call("subflow.listSubflowsByFlowId", { pflow_id: mflow._id.toString() });
                console.log("createdChildFlows", createdChildFlows_response?.data);
                this.publishSubflow(ctx, createdChildFlows_response?.data, branch_id, org_id, mflow);

                let nodes = mflow.nodes.map((node) => {
                    if (node.type === "saveDataNode") {
                        node.data.table = outcome_id;
                    }
                    if (node.type === "subflowNode") {
                        let item = createdChildFlows_response?.data.find((subflow) => subflow.title === node.data.subflow_title);
                        if (item) {
                            node.data.subflow = item?._id;
                            node.data.form_payload.subflow = item?._id;
                        }
                    }
                    if (node.type === "whatsappNode") {
                        console.log("whatsapp node", node.data.meta_payload.name);
                        let item = templates_new.find((template) => template.meta_templates[0].name.replace(/_\d+$/, "") === node.data.meta_payload.name);
                        console.log("template details:", item);
                        node.data.meta_payload.name = item?.name;
                        node.data.form_payload.template_id = item?.id.toString();
                        node.data.form_payload.template.name = item?.name;
                        node.data.form_payload.template.id = item?.id.toString();
                    }
                    return node;
                });
                let edges = mflow.edges;
                let mainFlow = {
                    fe_flow: {
                        nodes: nodes,
                        edges: edges,
                    },
                    updatedAt: new Date(),
                    status: "Active",
                };

                const record = await flowModel.updateOne({ _id: newObjectId }, { $set: mainFlow });  // do this first and create campaign and do the updating later
                console.log("updated flow", record);
                const campaign = await ctx.call("campaign.createUpdate", { id: campaignId, flowIds: [newObjectId.toString()] });
                console.log("updated campaign", campaign);
                await ctx.call("notification.send", {
                    templateKey: "flow_installation",
                    variables: {
                        flowName: `${mflow.title}-${randomFourDigit}` ?? "",
                        campaignId: campaignId,
                        flowDescription: mflow?.desc ?? "",
                        startDate: new Date().toISOString(),
                        endDate: new Date().toISOString(),
                        flowId: newObjectId.toString(),
                        flowIds: newObjectId.toString()
                    },
                    additionalData: {
                        branch_id: branch_id,
                        organisation_id: org_id
                    }
                });
            } catch (error) {
                console.log("error", error);
            }
        }
    }
};