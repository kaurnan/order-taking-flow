const dbMixin = require("../../mixins/db.mixin");
const { ObjectId } = require("mongodb");

"use strict";


module.exports = {
    name: "getstarted",
    mixins: [dbMixin("getstarted")],
    actions: {
        hello() {
            return "Welcome to Moleculer!";
        },

        InitializeGetStarted: {
            auth: "required",
            rest: {
                method: "POST",
            },
            params: {
                org_id: "string",
            },
            async handler(ctx) {
                try {
                    const org_id = new ObjectId(ctx.params.org_id);

                    // Check if the record already exists
                    const existingRecord = await this.adapter.findOne({ org_id });
                    if (existingRecord) {
                        return {
                            code: "400",
                            success: false,
                            message: "Get started progress already exists"
                        };
                    }

                    // Create a new record
                    const newRecord = {
                        org_id,
                    };

                    const createdRecord = await this.adapter.insert(newRecord);
                    console.log("Get started progress created:", createdRecord);
                    return {
                        code: "201",
                        success: true,
                        message: "Get started progress created successfully",
                        data: createdRecord
                    };
                } catch (error) {
                    console.error("Error creating get started progress:", error);
                    return {
                        code: "500",
                        success: false,
                        message: error.message
                    };
                }
            },
        },

        getGetStartedProgress: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/progress"
            },
            handler(ctx) {
                const { org_id, branch_id } = ctx.meta;

                return this.adapter.findOne({ org_id, branch_id })
                    .then((response) => {
                        if (response) {
                            return {
                                code: "200",
                                success: true,
                                message: "Get started progress fetched successfully",
                                data: response
                            };
                        } else {
                            return {
                                code: "404",
                                success: false,
                                message: "Get started progress not found"
                            };
                        }
                    })
                    .catch((error) => {
                        return {
                            code: "500",
                            success: false,
                            message: error.message
                        };
                    });

            },
        },

        /**
         * Action to update the get started progress
         * @returns {Promise<{code: string, success: boolean, message: string, data: object}>}
         */
        updateGetStartedProgress: {
            auth: "required",
            rest: {
                method: "PUT",
                path: "/progress"
            },
            params: {
                account_created: { type: "boolean", optional: true },
                channel_created: { type: "boolean", optional: true },
                integration_completed: { type: "boolean", optional: true },
                user_invited: { type: "boolean", optional: true },
                paid_plan: { type: "boolean", optional: true }
            },
            async handler(ctx) {
                try {
                    const { org_id } = ctx.meta;
                    const { account_created, channel_created, integration_completed, user_invited, paid_plan } = ctx.params;
                    let progress = {};
                    switch (true) {
                        case account_created !== undefined:
                            progress = { account_created };
                            break;
                        case channel_created !== undefined:
                            progress = { channel_created };
                            break;
                        case integration_completed !== undefined:
                            progress = { integration_completed };
                            break;
                        case user_invited !== undefined:
                            progress = { user_invited };
                            break;
                        case paid_plan !== undefined:
                            progress = { paid_plan };
                            break;
                        default:
                            return {
                                code: "400",
                                success: false,
                                message: "No valid field to update"
                            };
                    }
                    console.log("Progress to update:", progress);
                    const updatedData = await this.adapter.model.findOneAndUpdate(
                        { org_id },
                        { $set: progress },
                        { new: true }
                    );
                    return updatedData;
                } catch (error) {
                    console.error("Error updating progress:", error);
                    return {
                        code: "500",
                        success: false,
                        message: error.message
                    };
                }
            }
        },

        /**
         * Action to update user_invited to true when users are invited
         * @returns {Promise<{code: string, success: boolean, message: string, data: object}>}
         */
        updateUserInvited: {
            auth: "required",
            params: {
                org_id: { type: "string", min: 1 }
            },
            async handler(ctx) {
                try {
                    const { org_id } = ctx.params;
                    const orgObjectId = new ObjectId(org_id);

                    // Update the user_invited field to true
                    const updatedData = await this.adapter.model.findOneAndUpdate(
                        { org_id: orgObjectId },
                        { $set: { user_invited: true } },
                        { new: true }
                    );

                    if (!updatedData) {
                        // If no record exists, create one with user_invited: true
                        const newRecord = {
                            org_id: orgObjectId,
                            user_invited: true
                        };
                        const createdRecord = await this.adapter.insert(newRecord);
                        return {
                            code: "201",
                            success: true,
                            message: "Get started progress created with user_invited: true",
                            data: createdRecord
                        };
                    }

                    return {
                        code: "200",
                        success: true,
                        message: "User invited status updated successfully",
                        data: updatedData
                    };
                } catch (error) {
                    console.error("Error updating user_invited:", error);
                    return {
                        code: "500",
                        success: false,
                        message: error.message
                    };
                }
            }
        }

    }
};