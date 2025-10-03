const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;

"use strict";
const seedData = require("../../mixins/seedData/triggers.json"); // Assuming you have a JSON file with the seed data
module.exports = {
    name: "trigger",
    mixins: [dbMixin("flow/trigger")], // Add any mixins if needed
    settings: {
        // Define service settings here if needed
    },
    actions: {
        listTriggers: {
            auth: "required",
            rest: "GET /list",
            params: {
                // Define any parameters if needed
            },
            async handler(ctx) {
                // Logic to list all triggers
                if (!["automation_read", "full_control", "automation_write"].some(scope => ctx.meta.scopes.includes(scope))) {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
                const triggers = await this.adapter.find({});
                return {
                    success: true,
                    message: "Triggers fetched successfully",
                    data: triggers,
                };
            }
        },
    },
    methods: {
        async seedDB() {
            await this.adapter.insertMany(seedData);
        }
    },
};