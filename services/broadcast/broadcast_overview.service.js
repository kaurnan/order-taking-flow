const dbMixin = require("../../mixins/db.mixin");

"use strict";

module.exports = {
    name: "broadcast_overview",
    mixins: [dbMixin("broadcast_overview")],
    actions: {
        create: {
            params: {
                org_id: { type: "string", optional: false },
                branch_id: { type: "string", optional: false },
            },
            async handler(ctx) {
                const { org_id, branch_id } = ctx.params;

                // Validate org_id and branch_id
                if (!org_id || !branch_id) {
                    throw new Error("org_id and branch_id are required.");
                }

                // Check if overview already exists
                const existingOverview = await this.adapter.findOne({ org_id, branch_id });
                if (existingOverview) {
                    return {
                        success: false,
                        message: "Broadcast overview already exists for this organisation and branch."
                    };
                }

                // Create a new broadcast overview
                const newOverview = await this.adapter.insert({
                    org_id: new this.adapter.model.base.Types.ObjectId(org_id),
                    branch_id: new this.adapter.model.base.Types.ObjectId(branch_id),
                    total_failed: 0,
                    total_sent: 0,
                    total_delivered: 0,
                    total_read: 0,
                    total_clicked: 0,
                    total_replied: 0,
                    total_recipients: 0
                });

                return {
                    success: true,
                    data: newOverview,
                    message: "Broadcast overview created successfully."
                };
            }
        },
        getOverview: {
            auth: "required",
            params: {
            },
            async handler(ctx) {
                const { org_id, branch_id } = ctx.meta;

                // Validate org_id and branch_id
                if (!org_id || !branch_id) {
                    throw new Error("org_id and branch_id are required.");
                }

                // Fetch the broadcast overview for the given org_id and branch_id
                const overview = await this.adapter.findOne({ org_id, branch_id });

                if (!overview) {
                    throw new Error("Broadcast overview not found.");
                }

                return {
                    success: true,
                    data: overview,
                    message: "Broadcast overview fetched successfully.",
                };
            }
        },
        delete: {
            auth: "required",
            params: {
                branch_id: { type: "string", optional: false },
                org_id: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { branch_id, org_id } = ctx.params;

                // Validate branch_id
                if (!branch_id) {
                    throw new Error("branch_id is required.");
                }

                // Validate org_id from meta
                if (!org_id) {
                    throw new Error("org_id is required.");
                }

                // Find and delete the broadcast overview for the given org_id and branch_id
                const deletedOverview = await this.adapter.model.deleteOne({ 
                    org_id: new this.adapter.model.base.Types.ObjectId(org_id),
                    branch_id: new this.adapter.model.base.Types.ObjectId(branch_id)
                });

                if (!deletedOverview || deletedOverview.length === 0) {
                    return {
                        success: false,
                        message: "No broadcast overview found to delete for this organisation and branch."
                    };
                }

                return {
                    success: true,
                    message: "Broadcast overview deleted successfully.",
                    deletedCount: deletedOverview.length
                };
            }
        }
    },

    methods: {
    },

    created() {
        this.logger.info("broadcast_overview service created.");
    }
};