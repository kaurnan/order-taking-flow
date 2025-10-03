"use strict";
const Redis = require("ioredis");

require("dotenv").config();

const redisClient = new Redis(process.env.REDIS_URI, {
    maxRetriesPerRequest: null,
});
module.exports = {
    name: "agent",

    /**
     * Service settings
     */
    settings: {
        // Add your service settings here
    },

    /**
     * Service dependencies
     */
    // dependencies: [],

    /**
     * Actions
     */
    actions: {
        /**
         * Get the agent to be assigned to the chat based on the round robin algorithm.
         */
        getSmartAgent: {
            params: {
                org_id: "string",
                phone: "string",
            },
            async handler(ctx) {
                const { org_id } = ctx.params;
                const redisKey = `auto_assign:${org_id}`;
                const [OrganisationUsers, lastAssignedId] = await Promise.all([
                    ctx.call("ums_user_organisations.listUsersByOrgID", { org_id }),
                    redisClient.get(redisKey)
                ]);

                if (!OrganisationUsers.status) {
                    console.error("Failed to fetch organisation users:", OrganisationUsers.message);
                    return null;
                }
                const agents = OrganisationUsers.data.filter(
                    (user) => user.is_active === "Active"
                );

                if (!agents.length) return null;

                if (!lastAssignedId) {
                    const firstAgent = agents[0];
                    await redisClient.set(redisKey, firstAgent.user_id.toString());
                    return firstAgent.user_id;
                }

                const index = agents.findIndex((agent) => agent.user_id.toString() === lastAssignedId);
                const nextIndex = (index + 1) % agents.length;
                const nextAgent = agents[nextIndex];

                await redisClient.set(redisKey, nextAgent.user_id.toString());

                return nextAgent.user_id;
            },
        }
    },

    /**
     * Events
     */
    events: {
        // Define your events here
    },

    /**
     * Methods
     */
    methods: {
        // Define your methods here
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        // Called when the service is created
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {
        // Called when the service is started
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {
        // Called when the service is stopped
        redisClient.disconnect(); // Disconnect Redis client when service stops
    },
};