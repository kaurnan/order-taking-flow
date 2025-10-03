const bulkCustomerUpdateQueue = require("../../queues/bulk-customer-update.queue");
const customerExportQueue = require("../../queues/customer-export.queue");

module.exports = {
    name: "bulkaction",
    actions: {
        /**
         * Export customers to CSV.
         * @param {Object} ctx - Moleculer's context
         * Only for internal use, not exposed via REST API.
         */
        exportCustomers: {
            async handler(ctx) {
                const query = ctx.params.query;
                try {
                    const userDetails = await ctx.call("ums_user.get", { id: ctx.meta._id });

                    const jobData = {
                        ...query,
                        org_id: ctx?.meta?.org_id,
                        branch_id: ctx?.meta?.branch_id,
                        user_id: userDetails._id,
                        user_image: userDetails?.user_image
                    };
                    // Add job to BullMQ queue
                    const job = await customerExportQueue.add("customer-export", jobData, {
                        removeOnComplete: true,
                        removeOnFail: false
                    });

                    console.log(`Customer export job ${job.id} queued successfully`);

                    // Send immediate notification that job is queued
                    await ctx.call("notification.send", {
                        templateKey: "customer_export_queued",
                        variables: {
                            successMessage: "Your customer export job has been queued and will be processed shortly.",
                            userImage: userDetails?.user_image
                        },
                        additionalData: {
                            branch_id: ctx?.meta?.branch_id,
                            organisation_id: ctx?.meta?.org_id,
                            user_id: userDetails._id
                        }
                    });

                    return "result";
                } catch (err) {
                    console.log("Error during CSV export:", err);
                    throw new Error("CSV export failed");
                }
            }

        },

        /**
         * Bulk update customers based on the action and query.
         * @param {Object} ctx - Moleculer's context
         * Only for internal use, not exposed via REST API.
         */
        bulkCustomerUpdate: {
            async handler(ctx) {
                const query = ctx.params.query;
                const action = ctx.params.action;
                const data = ctx.params.data;
                console.log("Bulk customer update action:", action);
                console.log("Bulk customer update data:", data);
                console.log("Bulk customer update query:", query);
                try {
                    let messages = await ctx.call("notification.getBulkActionMessages", { action });

                    console.log("Bulk customer update with query:", query);
                    const userDetails = await ctx.call("ums_user.get", { id: ctx.meta._id });

                    // Add job to BullMQ queue
                    const job = await bulkCustomerUpdateQueue.add("bulk-customer-update", {
                        action,
                        query,
                        data,
                        org_id: query.org_id,
                        branch_id: query.branch_id,
                        user_id: userDetails._id,
                        user_image: userDetails?.user_image
                    }, {
                        removeOnComplete: true,
                        removeOnFail: false
                    });

                    console.log(`Bulk customer update job ${job.id} queued successfully`);

                    // Send immediate notification that job is queued
                    await ctx.call("notification.send", {
                        templateKey: "bulk_action_queued",
                        variables: {
                            actionTitle: messages.title,
                            successMessage: "Your bulk customer update job has been queued and will be processed shortly.",
                            userImage: userDetails?.user_image
                        },
                        additionalData: {
                            branch_id: query.branch_id,
                            organisation_id: query.org_id,
                            user_id: userDetails._id
                        }
                    });

                    return "result";
                } catch (err) {
                    console.log("Error during bulk customer update:", err);
                    throw new Error("Bulk customer update failed");
                }
            }
        }
    },

    methods: {
        // Export success notifications are now handled by the BullMQ worker
    },

    async stopped() {
        console.log("Bulk action service stopped");
    }
};
