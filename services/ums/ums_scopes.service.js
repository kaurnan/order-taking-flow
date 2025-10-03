"use strict";

const dbMixin = require("../../mixins/db.mixin");



module.exports = {
    name: "ums_scopes",
    mixins: [dbMixin("ums/scopes")],

    /**
     * Service settings
     */
    settings: {
        // Define service settings here
    },

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {
        /**
         * List all scopes
         */
        listScopes: {
            auth: "required",
            rest: "GET /",
            async handler() {
                const docs = await this.adapter.model
                    .find({}); // Filter by app ID
                return { message: "Scopes fetched successfully", data: docs };
            },
        },

        /**
         * Get a scope by ID
         */
        getScope: {
            rest: "GET /:access",
            params: {
                access: "string",
            },
            async handler(ctx) {
                const { access } = ctx.params;
                return await this.adapter.findOne({ access });
            },
        },

    },

    /**
     * Service methods
     */
    methods: {
        /**
         * Loading sample data to the collection.
         * It is called in the DB.mixin after the database
         * connection establishing & the collection is empty.
         */
        async seedDB() {
            await this.adapter.insertMany([
                {
                    "name": "Conversation Write",
                    "desc": "Allowed to create and manage conversations",
                    "access": "conversation_write",

                },
                {
                    "name": "Conversation Read",
                    "desc": "Allowed to read conversations",
                    "access": "conversation_read",

                },
                {
                    "name": "Automation Write",
                    "desc": "Allowed to create and manage automations",
                    "access": "automation_write",

                },
                {
                    "name": "Automation Read",
                    "desc": "Allowed to read automations",
                    "access": "automation_read",

                },
                {
                    "name": "Campaign Write",
                    "desc": "Allowed to create and manage campaigns",
                    "access": "campaign_write",

                },
                {
                    "name": "Campaign Read",
                    "desc": "Allowed to read campaigns",
                    "access": "campaign_read",

                },
                {
                    "name": "Broadcast Write",
                    "desc": "Allowed to create and manage broadcasts",
                    "access": "broadcast_write",

                },
                {
                    "name": "Broadcast Read",
                    "desc": "Allowed to read broadcasts",
                    "access": "broadcast_read",

                },
                {
                    "name": "Audience Write",
                    "desc": "Allowed to create and manage audiences",
                    "access": "audience_write",

                },
                {
                    "name": "Audience Read",
                    "desc": "Allowed to read audiences",
                    "access": "audience_read",

                },
                {
                    "name": "Integration Write",
                    "desc": "Allowed to create and manage integrations",
                    "access": "integration_write",

                },
                {
                    "name": "Integration Read",
                    "desc": "Allowed to read integrations",
                    "access": "integration_read",

                },
                {
                    "name": "Channel Write",
                    "desc": "Allowed to create and manage channels",
                    "access": "channel_write",

                },
                {
                    "name": "Channel Read",
                    "desc": "Allowed to read channels",
                    "access": "channel_read",

                },
                {
                    "name": "Branch Write",
                    "desc": "Allowed to create and manage branches",
                    "access": "branch_write",

                },
                {
                    "name": "Branch Read",
                    "desc": "Allowed to read branches",
                    "access": "branch_read",

                },
                {
                    "name": "WABA Write",
                    "desc": "Allowed to create and manage WABA",
                    "access": "waba_write",

                },
                {
                    "name": "WABA Read",
                    "desc": "Allowed to read WABA",
                    "access": "waba_read",

                },
                {
                    "name": "Full Control",
                    "desc": "Allowed to have full control over the application",
                    "access": "full_control",

                }
            ]);
        }
    },

    /**
     * Service lifecycle events
     */
    events: {
        // Define service events here
    },

    /**
     * Service created lifecycle event
     */
    created() {
        // Called when the service is created
    },

    /**
     * Service started lifecycle event
     */
    async started() {
        // Called when the service is started
    },

    /**
     * Service stopped lifecycle event
     */
    async stopped() {
        // Called when the service is stopped
    },

};