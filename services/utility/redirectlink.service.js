const DbMixin = require('../../mixins/db.mixin');
const RedirectLinkModel = require('../../models/redirectlink.model');

module.exports = {
    name: 'redirectlink',
    mixins: [DbMixin('redirectlink')],
    model: RedirectLinkModel,

    settings: {
        fields: ['_id', 'shortCode', 'targetUrl', 'clicks', 'createdAt'],
        populates: {},
    },

    actions: {
        /**
         * Generate a shortened or redirect link for a given target URL.
         *
         * @param {String} targetUrl - The URL to shorten.
         * @returns {Object} - The created redirect link object.
         */
        generate: {
            params: {
                targetUrl: { type: 'string' },
            },
            async handler(ctx) {
                const { targetUrl } = ctx.params;
                let shortCode = this.generateShortCode();
                let existingLink = await this.adapter.findOne({ targetUrl });

                if (existingLink) {
                    return existingLink;
                }

                // Ensure short code is unique
                let isUnique = false;
                while (!isUnique) {
                    const found = await this.adapter.findOne({ shortCode });
                    if (!found) {
                        isUnique = true;
                    } else {
                        shortCode = this.generateShortCode(); // Regenerate if not unique
                    }
                }

                const newLink = await this.adapter.insert({
                    shortCode,
                    targetUrl,
                    clicks: 0,
                });
                return newLink;
            },
        },

        /**
         * Redirect to the target URL and increment click count.
         *
         * @param {String} shortCode - The short code to redirect.
         * @returns {String} - The target URL.
         */
        redirect: {
            params: {
                shortCode: { type: 'string' },
            },
            async handler(ctx) {
                const { shortCode } = ctx.params;
                const link = await this.adapter.findOne({ shortCode });

                if (!link) {
                    throw new Error('Link not found');
                }

                // Increment click count
                await this.adapter.updateById(link._id, { $inc: { clicks: 1 } });

                return link.targetUrl;
            },
        },

        /**
         * Get a redirect link by short code.
         *
         * @param {String} shortCode - The short code to retrieve.
         * @returns {Object} - The redirect link object.
         */
        get: {
            params: {
                shortCode: { type: 'string' },
            },
            async handler(ctx) {
                const { shortCode } = ctx.params;
                const link = await this.adapter.findOne({ shortCode });
                if (!link) {
                    throw new Error('Link not found');
                }
                return link;
            },
        },
    },

    methods: {
        /**
         * Generates a random alphanumeric short code.
         * @returns {String}
         */
        generateShortCode() {
            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            const charactersLength = characters.length;
            for (let i = 0; i < 6; i++) { // Generate a 6-character short code
                result += characters.charAt(Math.floor(Math.random() * charactersLength));
            }
            return result;
        },
    },

    /**
     * Service created lifecycle event handler
     */
    async created() { },

    /**
     * Service started lifecycle event handler
     */
    async started() { },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() { },
};
