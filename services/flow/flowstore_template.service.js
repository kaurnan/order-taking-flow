const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;

"use strict";

module.exports = {
    name: "flowstore_template",
    mixins: [dbMixin("flowstore/template")],
    settings: {
        // Add service settings here
    },
    dependencies: [],
    actions: {
        listTemplates: {
            rest: "GET /templates",
            auth: "required",
            params: {
                query: { type: "object" }
            },
            async handler(ctx) {
                const { query } = ctx.params;
                console.log("Fetching templates with query:", JSON.stringify(query));
                if (ctx.meta.scopes.includes("full_control")) {
                    try {
                        const templates = await this.adapter.model.find(query);
                        if (!templates || templates.length === 0) {
                            throw new MoleculerError("No templates found", 404, "TEMPLATES_NOT_FOUND");
                        }

                        return {
                            success: true,
                            message: "Templates retrieved successfully",
                            data: templates
                        };

                        // Proceed with the purchase logic
                    } catch (error) {
                        console.error("Error retrieving templates:", error);
                        return {
                            code: "500",
                            success: false,
                            message: "An error occurred while retrieving the templates",
                            details: error.message,
                        };
                    }
                } else {
                    throw new MoleculerError("Unauthorized", 403, "UNAUTHORIZED");
                }
            },
        }
    },
    events: {
        // Add event listeners here
    },
    methods: {
        // Add service methods here
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
