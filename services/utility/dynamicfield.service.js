const { MoleculerClientError } = require('moleculer').Errors;
const dynamicFieldsConfig = require('../../config/dynamicFields.json');
const dbMixin = require('../../mixins/db.mixin');

module.exports = {
    name: 'dynamicfield',
    mixins: [dbMixin("dynamicfield")],

    settings: {
        fields: ['_id', 'platform', 'key', 'type', 'label', 'branch_id', 'created_at', 'updated_at'],
        populates: {
            branch_id: {
                action: 'branch.get',
                params: {
                    fields: ['_id', 'name']
                }
            }
        }
    },

    actions: {
        /**
         * Get dynamic fields for a specific branch and platform.
         * @returns {Array<Object>} List of dynamic fields.
         */
        getDynamicFields: {
            auth: "required",
            rest: 'GET /:branch_id/:platform',
            params: {
            },
            async handler(ctx) {
                const { branch_id } = ctx.meta;
                const dynamicFields = await this.adapter.find({ query: { branch_id } });
                return {
                    success: true,
                    message: "Dynamic fields retrieved successfully",
                    data: dynamicFields,
                };
            }
        },

        /**
         * Seed dynamic fields from configuration for a given platform and branch.
         * This action should be called when a new integration is successful.
         * @returns {Array<Object>} List of created dynamic fields.
         */
        seedDynamicFields: {
            params: {
                platform: 'string',
                branch_id: 'string'
            },
            async handler(ctx) {
                const { platform, branch_id } = ctx.params;
                const fieldsToSeed = dynamicFieldsConfig[platform];

                if (!fieldsToSeed || fieldsToSeed.length === 0) {
                    throw new MoleculerClientError(`No dynamic fields configured for platform: ${platform}`, 404, 'NO_FIELDS_CONFIGURED');
                }

                const createdFields = [];
                for (const field of fieldsToSeed) {
                    try {
                        const newField = await this.adapter.insert({
                            platform,
                            key: field.key,
                            type: field.type,
                            label: field.label,
                            branch_id
                        });
                        createdFields.push(newField);
                    } catch (error) {
                        if (error.code === 11000) { // Duplicate key error
                            this.logger.warn(`Dynamic field '${field.key}' for platform '${platform}' and branch '${branch_id}' already exists. Skipping.`);
                        } else {
                            this.logger.error(`Error seeding dynamic field '${field.key}':`, error);
                            throw new MoleculerClientError(`Failed to seed dynamic field '${field.key}'`, 500, 'SEED_FIELD_ERROR', { field: field.key, error: error.message });
                        }
                    }
                }
                return createdFields;
            }
        }
    },

    methods: {
        /**
         * Populate the `meta` field in customer data with dynamic fields.
         * This method can be called from other services (e.g., customer.service, shopifyCustomerSync.worker).
         * @param {Object} customerData - The customer data object.
         * @param {string} branchId - The branch ID.
         * @param {string} platform - The platform name (e.g., 'shopify', 'perpooja').
         * @returns {Object} Updated customerData with populated meta field.
         */
        async populateCustomerMeta(customerData, branchId, platform) {
            const dynamicFields = await this.broker.call('dynamicfield.getDynamicFields', { branch_id: branchId, platform });
            const meta = {};

            if (dynamicFields && dynamicFields.length > 0) {
                meta[platform] = {};
                for (const field of dynamicFields) {
                    if (customerData[field.key] !== undefined) {
                        meta[platform][field.key] = customerData[field.key];
                    }
                }
            }
            customerData.meta = { ...customerData.meta, ...meta };
            return customerData;
        }
    },

    async afterConnected() {
        this.logger.info('DynamicField service connected to MongoDB.');
    }
};
