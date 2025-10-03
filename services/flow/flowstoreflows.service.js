const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const listModel = require("../../models/flowstore/list.model");

"use strict";

module.exports = {
    name: "flowstorelistcheckout",
    mixins: [dbMixin("flowstore/flows")],
    settings: {
        // Add service settings here
    },
    dependencies: [],
    actions: {
        purchaseFlow: {
            rest: "GET /purchase",
            auth: "required",
            params: {
                handle: { type: "string", required: true }
            },
            async handler(ctx) {
                const { handle } = ctx.params;
                if (ctx.meta.scopes.includes("flow_write") || ctx.meta.scopes.includes("full_control")) {
                    try {
                        const list = await listModel.findOne({ handle: handle });
                        // Logic to handle flow purchase
                        const flow = await this.adapter.findOne({ listing_id: new ObjectId(list._id) });
                        if (!flow) {
                            throw new MoleculerError("Flow not found", 404, "FLOW_NOT_FOUND");
                        }
                        const response = await this.installFlow(ctx, handle);
                        return {
                            success: true,
                            message: "Successfully purchased flow. You will be notified when the flow is installed.",
                            data: response?.data,
                        };

                    } catch (error) {
                        console.error("Error purchasing flow:", error);
                        return {
                            code: "500",
                            success: false,
                            message: "An error occurred while purchasing the flow",
                            details: error.message,
                        };
                    }
                } else {
                    throw new MoleculerError("Unauthorized", 403, "UNAUTHORIZED");
                }
            },
        },
        GetFlowByListingId: {
            rest: "GET /:id",
            auth: "required",
            params: {
                id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { id } = ctx.params;

                if (ctx.meta.scopes.includes("flow_read") || ctx.meta.scopes.includes("full_control")) {
                    try {
                        const flow = await this.adapter.findOne({ listing_id: new ObjectId(id) });
                        if (!flow) {
                            throw new MoleculerError("Flow not found", 404, "FLOW_NOT_FOUND");
                        }

                        return {
                            success: true,
                            message: "Flow retrieved successfully",
                            data: flow
                        };
                    } catch (error) {
                        console.error("Error retrieving flow:", error);
                        return {
                            code: "500",
                            success: false,
                            message: "An error occurred while retrieving the flow",
                            details: error.message,
                        };
                    }
                } else {
                    throw new MoleculerError("Unauthorized", 403, "UNAUTHORIZED");
                }
            }
        }
    },
    events: {
        // Add event listeners here
    },
    methods: {
        async installFlow(ctx, handle) {
            const response = await ctx.call("reactflow.installFlow", { handle: handle });
            return response;
        }
    },
    created() {
        // Called when the service is created
    },
    started() {

        // Called when the service is started
    },
    stopped() {
        // Called when the service is stopped
    },
};
