const dbMixin = require("../../mixins/db.mixin");
const { ObjectId } = require("mongodb");

"use strict";


module.exports = {
    name: "integrations",
    mixins: [dbMixin("integrations")],

    /**
     * Actions
     */
    actions: {

        /**
         * List all integrations of the current branch
         */
        listIntegrations: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/integrations"
            },
            async handler() {
                const integrations = await this.getList();
                return integrations;
            }
        },

        getSpecificIntegration: {
            auth: "required",
            rest: {
                method: "GET",
            },
            params: {
                name: "string",
            },
            async handler(ctx) {
                const { name } = ctx.params;
                const { branch_id, org_id } = ctx.meta;
                if (!name) {
                    throw new Error("Integration name is required");
                }
                const integration = await this.adapter.findOne({ name, branch_id, org_id });
                if (!integration) {
                    return {
                        success: false,
                        message: "Integration not found",
                        data: null,
                    };
                }
                return {
                    success: true,
                    message: "Integration found",
                    data: integration
                };
            }
        },

        /**
        * Handles the creation or update of a Shopify integration for a given branch and organization.
        *
        * - If an integration with the specified shop domain, branch, and organization exists, it updates the integration's config.
        * - Otherwise, it creates a new Shopify integration entry.
        * - After saving, it seeds dynamic fields for Shopify using the 'dynamicfield.seedDynamicFields' action.
        * - Returns a success message and the integration data on success, or an error message on failure.
        *
        * @async
        * @param {Context} ctx - Moleculer context object containing parameters and metadata.
        * @param {Object} ctx.params - Parameters for Shopify integration.
        * @param {string} ctx.params.api_key - Shopify API key.
        * @param {string} ctx.params.api_secret_key - Shopify API secret key.
        * @param {string} ctx.params.access_token - Shopify access token.
        * @param {string} ctx.params.shop_domain - Shopify shop domain.
        * @param {Object} ctx.meta - Metadata containing branch and organization IDs.
        * @param {string|number} ctx.meta.branch_id - Branch identifier.
        * @param {string|number} ctx.meta.org_id - Organization identifier.
        * @returns {Promise<Object>} Result object containing status/success, message, and integration data or error.
        * @throws {Error} Logs and returns error details if integration save fails.
        */
        saveShopifyIntegration: {
            // auth: "required",
            params: {
                api_key: "string",
                api_secret_key: "string",
                access_token: "string",
                shop_domain: "string",
            },
            async handler(ctx) {
                const { api_key, api_secret_key, access_token, shop_domain } = ctx.params;
                const { branch_id, org_id } = ctx.meta;

                try {
                    let integration = await this.adapter.model.findOne({ "config.shop_domain": shop_domain, branch_id: new ObjectId(branch_id), org_id: new ObjectId(org_id), name: "Shopify" });

                    if (integration) {
                        integration.config = {
                            api_key,
                            api_secret_key,
                            access_token,
                            shop_domain
                        };
                        integration.updatedAt = Date.now();
                        await integration.save();
                        this.broker.emit("shopify.integrated", { shop_domain, access_token }); // Emit event
                        await ctx.call('dynamicfield.seedDynamicFields', { platform: "shopify", branch_id });
                        return { status: true, message: "Shopify integration updated successfully", data: integration };
                    } else {
                        integration = await this.adapter.model.create({
                            name: "Shopify",
                            type: "API",
                            config: {
                                api_key,
                                api_secret_key,
                                access_token,
                                shop_domain
                            },
                            branch_id: new ObjectId(branch_id),
                            org_id: new ObjectId(org_id),
                            isActive: true
                        });
                        this.broker.emit("shopify.integrated", { shop_domain, access_token }); // Emit event
                        await ctx.call('dynamicfield.seedDynamicFields', { platform: "shopify", branch_id });
                        return { success: true, message: "Shopify integration created successfully", data: integration };
                    }
                } catch (error) {
                    this.logger.error("Error saving Shopify integration:", error);
                    return { status: 500, message: "Failed to save Shopify integration", error: error.message };
                }
            }
        },
    },
};
