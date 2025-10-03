const dbMixin = require("../../mixins/db.mixin");

"use strict";


module.exports = {
    name: "flowstore_category",
    mixins: [dbMixin("flowstore/category")],

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
         * List all categories
         */
        list: {
            rest: "GET /",
            async handler() {
                // Fetch and return categories
                return await this.adapter.model.find({});
            },
        },

        /**
         * Get a category by ID
         */
        get: {
            rest: "GET /:id",
            params: {
                id: "string",
            },
            async handler(ctx) {
                const { id } = ctx.params;
                return await this.getCategoryById(id);
            },
        },

        /**
         * Create a new category
         */
        create: {
            rest: "POST /",
            params: {
                name: "string",
                description: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { name, description } = ctx.params;
                return await this.createCategory({ name, description });
            },
        },

        /**
         * Update a category
         */
        update: {
            rest: "PUT /:id",
            params: {
                id: "string",
                name: { type: "string", optional: true },
                description: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { id, name, description } = ctx.params;
                return await this.updateCategory(id, { name, description });
            },
        },

        /**
         * Delete a category
         */
        remove: {
            rest: "DELETE /:id",
            params: {
                id: "string",
            },
            async handler(ctx) {
                const { id } = ctx.params;
                return await this.deleteCategory(id);
            },
        },
    },

    /**
     * Methods
     */
    methods: {
        async getCategories() {

            return [];
        },

        async getCategoryById(id) {
            // Logic to fetch a category by ID
            return { id, name: "Sample Category", description: "Sample Description" };
        },

        async createCategory(category) {
            // Logic to create a new category
            return { id: "new-id", ...category };
        },

        async updateCategory(id, updates) {
            // Logic to update a category
            return { id, ...updates };
        },

        async deleteCategory(id) {
            // Logic to delete a category
            return { id, deleted: true };
        },
    },

    /**
     * Service lifecycle events
     */
    events: {},

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