const DbMixin = require("../../mixins/db.mixin");

"use strict";


module.exports = {
    name: "flow_stats",
    mixins: [DbMixin("flow/flow_stats")],
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
                flow_id: { type: "string", required: true },
                org_id: { type: "string", required: true },
                branch_id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { flow_id, org_id, branch_id } = ctx.params;
                await this.adapter.insert({ flow_id, org_id, branch_id });
            },
        },
        delete: {
            rest: "DELETE /",
            auth: "required",
            params: {
                flow_id: { type: "string", required: true },
                org_id: { type: "string", required: true },
                branch_id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { flow_id, org_id, branch_id } = ctx.params;
                await this.adapter.model.deleteOne({ flow_id, org_id, branch_id });
            },
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