const DbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;

"use strict";


module.exports = {
    name: "default_flows",
    mixins: [DbMixin("flow/default_flows")],
    settings: {
        // Add service settings here if needed
    },
    dependencies: [],
    events: {
        // Add event handlers here if needed
    },
    actions: {
        getDefaultFlow: {
            rest: "GET /",
            auth: "required",
            params: {
                id: { type: "string", required: true },
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const flow = await this.adapter.findOne({ _id: id });
                if (!flow) throw new MoleculerError("Flow not found", 404, "FLOW_NOT_FOUND");
                return flow;
            },
        },
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