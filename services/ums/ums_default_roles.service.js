"use strict";

const dbMixin = require("../../mixins/db.mixin");


/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
    name: "ums_default_roles",

    /**
     * Mixins
     */
    mixins: [dbMixin("ums/default_roles")],

    /**
     * Settings
     */
    settings: {
    },


    /**
     * Methods
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
                    "name": "Admin", "descriptions": "Administrator role with full access to all features",
                    "scopes": [
                        "allow_all",
                    ]
                }
            ]);
        }
    },

    /**
     * Fired after database connection establishing.
     */
    async afterConnected() {
        // await this.adapter.collection.createIndex({ name: 1 });
    }
};
