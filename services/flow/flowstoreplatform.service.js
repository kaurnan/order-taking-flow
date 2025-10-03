const dbMixin = require("../../mixins/db.mixin");

"use strict";


module.exports = {
    name: "flowstoreplatform",
    mixins: [dbMixin("flowstore/platform")],
    /**
     * Service settings
     */
    settings: {
        // Define service-level settings here
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
         * Example action
         */
        hello: {
            rest: {
                method: "GET",
                path: "/hello",
            },
            async handler() {
                return "Hello from Flowstore Platform!";
            },
        },

        listPlatforms: {
            rest: {
                method: "GET",
                path: "/list",
            },
            async handler() {
                const platforms = await this.adapter.find({});
                return platforms;
            },
        }

        /**
         * Add more actions here
         */
    },

    /**
     * Events
     */
    events: {
        /**
         * Example event handler
         */
        "some.event"(payload) {
            this.logger.info("Event received:", payload);
        },
    },

    /**
     * Methods
     */
    methods: {
        /**
         * Example method
         */
        someMethod() {
            return "This is a private method";
        },
    },

    /**
     * Service lifecycle events
     */
    created() {
        this.logger.info("Flowstore Platform service created.");
    },

    started() {
        this.logger.info("Flowstore Platform service started.");
    },

    stopped() {
        this.logger.info("Flowstore Platform service stopped.");
    },
};