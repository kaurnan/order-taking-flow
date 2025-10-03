const dbMixin = require("../../mixins/db.mixin");
const { ObjectId } = require("mongodb");
const InteraktTPsignup = require("../../utils/intrakt");
const { default: axios } = require("axios");
const { MoleculerError } = require("moleculer").Errors;

"use strict";
require("dotenv").config();

module.exports = {
    name: "channel",
    mixins: [dbMixin("channel")],
    settings: {
        // Add service settings here if needed
    },
    dependencies: [],
    actions: {
        createChannel: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/channels"
            },
            params: {
                waba_id: { type: "string", required: true },
                phone_number_details: { type: "object", optional: true },
                email: { type: "string", optional: true },
                description: { type: "string", optional: true },
                address: { type: "string", optional: true },
                profile_picture_url: { type: "string", optional: true },
            },

            async handler(ctx) {
                console.log("Received parameters:", ctx.params);
                const { waba_id, websites, email, description, address, profile_picture_url, phone_number_details } = ctx.params;
                const org_id = new ObjectId(ctx.meta.org_id);
                const channelData = {
                    waba_id, websites,
                    email,
                    description,
                    address,
                    org_id,
                    profile_picture_url,
                    phone_number_details
                };
                const channel = await this.adapter.insert(channelData);
                InteraktTPsignup(waba_id, phone_number_details.display_phone_number).then((response) => {
                    console.log("Interakt request response:", response.data);
                }).catch((error) => {
                    console.error("Error sending Interakt request:", error);
                });
                // Add logic to handle channel creation here
                return channel;
            }
        },
        getChannel: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/channels/:id"
            },
            params: {
                id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const channel = await this.adapter.findOne({ _id: new ObjectId(id) });
                if (!channel) {
                    throw new Error("Channel not found");
                }
                return {
                    success: true,
                    message: "Channel retrieved successfully",
                    data: channel
                };

            },
        },


        /**
            * Update a channel by ID
            */
        updateChannel: {
            auth: "required",
            rest: {
                method: "POST",
            },
            params: {
                id: { type: "string", required: true },
                websites: { type: "array", items: "string", optional: true },
                email: { type: "string", optional: true },
                description: { type: "string", optional: true },
                address: { type: "string", optional: true },
                profile_picture_url: { type: "string", optional: true },
            },
            async handler(ctx) {

                try {
                    const { id, websites, email, description, address, profile_picture_url } = ctx.params;
                    if (!id) {
                        throw new MoleculerError("Channel ID is required", 400, "BAD_REQUEST");
                    }
                    if (!ctx.meta.scopes.includes("channel_write") && !ctx.meta.scopes.includes("full_control")) {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }
                    const update = {};
                    if (websites !== undefined) update.websites = websites;
                    if (email !== undefined) update.email = email;
                    if (description !== undefined) update.description = description;
                    if (address !== undefined) update.address = address;
                    if (profile_picture_url !== undefined) update.profile_picture_url = profile_picture_url;
                    if (profile_picture_url) {
                        const channel = await this.adapter.model.findById(id);
                        console.log("Channel details:", channel);
                        const response = await axios.post(
                            `https://graph.facebook.com/v23.0/${channel.waba_id}/whatsapp_business_profile`,
                            {
                                messaging_product: "whatsapp",
                                address: address ?? "",
                                email: email ?? "",
                                description: description ?? "",
                                websites: Array.isArray(websites) && websites.length === 0 ? "" : websites,
                                profile_picture_handle: profile_picture_url
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`
                                }
                            }
                        );
                        console.log("Facebook API response:", response.data);

                    } else {
                        const channel = await this.adapter.model.findById(id);
                        console.log("Channel details:", channel);
                        const response = await axios.post(
                            `https://graph.facebook.com/v23.0/${channel.waba_id}/whatsapp_business_profile`,
                            {
                                messaging_product: "whatsapp",
                                address: address ?? "",
                                email: email ?? "",
                                description: description ?? "",
                                websites: websites == [] ? "" : websites,
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`
                                }
                            }
                        );
                        console.log("Facebook API response:", response.data);
                    }
                    const updated = await this.adapter.updateById(id, { $set: update });
                    if (!updated) {
                        throw new Error("Channel not found");
                    }
                    return {
                        success: true,
                        message: "Channel updated successfully",
                        data: updated
                    };
                } catch (e) {
                    console.error("Error updating channel:", e);
                    throw new MoleculerError("Invalid JSON in meta part", 400, "BAD_REQUEST");
                }
            }
        },
        getChannelByPhoneNumberId: {
            auth: "required",
            rest: {
                method: "GET",

                path: "/channels/phone/:phone_number_id"
            },
            params: {
                phone_number_id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { phone_number_id } = ctx.params;
                const channel = await this.adapter.findOne({ "phone_number_details.id": phone_number_id });
                if (ctx.meta.scopes.includes("channel_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("channel_write")) {
                    if (!channel) {
                        throw new Error("Channel not found");
                    }
                    return {
                        success: true,
                        message: "Channel retrieved successfully",
                        data: channel
                    };
                }
                else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },
        getChannels: {
            auth: "required",
            rest: {
                method: "GET",
            },
            async handler(ctx) {
                const org_id = new ObjectId(ctx.meta.org_id);
                if (ctx.meta.scopes.includes("channel_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("channel_write")) {
                    const channels = await this.adapter.model.find({ org_id });
                    if (!channels || channels.length === 0) {
                        return {
                            success: false,
                            message: "No channels found for this organization",
                            data: []
                        };
                    }
                    return {
                        success: true,
                        message: "Channels retrieved successfully",
                        data: channels
                    };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        getChannelsDirect: {
            params: {
                orgId: { type: "string", required: true }
            },
            async handler(ctx) {
                const { orgId } = ctx.params;
                const org_id = new ObjectId(orgId);
                
                const channels = await this.adapter.model.find({ org_id });
                if (!channels || channels.length === 0) {
                    return {
                        success: false,
                        message: "No channels found for this organization",
                        data: []
                    };
                }
                
                return {
                    success: true,
                    message: "Channels retrieved successfully",
                    data: channels
                };
            }
        },

        getWabas: {
            params: {
                org_id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { org_id } = ctx.params;
                if (!org_id) {
                    throw new MoleculerError("Organization ID is required", 400, "BAD_REQUEST");
                }
                const wabas = await this.adapter.model.aggregate([
                    {
                        $match: {
                            "org_id": new ObjectId(org_id) // Filter by specific org_id
                        }
                    },
                    {
                        $group: {
                            _id: "$waba_id" // Group by unique waba_id
                        }
                    }
                ]);
                if (!wabas || wabas.length === 0) {
                    throw new MoleculerError("No WABAs found for this organization", 404, "NOT_FOUND");
                }
                return wabas;
            }
        },

        /**
         * Get all channels for a specific organisation
         */
        getChannelsByOrgId: {
            params: {
                org_id: { type: "string", required: true }
            },
            async handler(ctx) {
                const { org_id } = ctx.params;
                if (!org_id) {
                    throw new MoleculerError("Organization ID is required", 400, "BAD_REQUEST");
                }

                const channels = await this.adapter.model.find({
                    org_id: new ObjectId(org_id),
                    deleted: { $ne: true } // Exclude deleted channels
                });

                if (!channels || channels.length === 0) {
                    return [];
                }

                return channels;
            }
        }
    },
    events: {
        // Add event handlers here if needed
    },
    methods: {
        // Add service methods here if needed

        async streamToBuffer(stream) {
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        },

        async setupChangeStream() {
            try {
                const collection = this.adapter.model.collection;
                if (!collection) {
                    this.logger.error("Collection is not defined");
                    return;
                }

                // Close existing stream if it exists
                if (this.changeStream) {
                    try {
                        this.changeStream.close();
                    } catch (closeError) {
                        this.logger.error("Error closing ChangeStream:", closeError);
                    }
                }

                this.changeStream = collection.watch();

                this.changeStream.on("change", async (change) => {
                    this.logger.debug("Change detected:", change);
                    if (change.operationType === "insert") {
                        const newChannel = change.fullDocument;
                        try {
                            const updateResult = await this.broker.call("getstarted.updateGetStartedProgress", {
                                org_id: newChannel.org_id,
                                channel_created: true
                            }, {
                                meta: {
                                    org_id: newChannel.org_id
                                }
                            });
                            this.logger.info("Progress updated after insert:", updateResult);
                        } catch (error) {
                            this.logger.error("Error updating progress after channel insert:", error);
                        }
                    } else if (change.operationType === "update") {
                        const updatedChannelId = change.documentKey._id;
                        const updatedFields = change.updateDescription.updatedFields;

                        if (Object.prototype.hasOwnProperty.call(updatedFields, "deleted")) {
                            try {
                                const updatedChannel = await this.adapter.findOne({ _id: updatedChannelId });
                                if (updatedChannel) {
                                    setTimeout(async () => {
                                        try {
                                            const otherChannels = await this.adapter.model.find({
                                                org_id: updatedChannel.org_id,
                                                deleted: false
                                            });
                                            if (otherChannels.length === 0) {
                                                await this.broker.call("getstarted.updateGetStartedProgress", {
                                                    org_id: updatedChannel.org_id,
                                                    channel_created: false
                                                }, {
                                                    meta: {
                                                        org_id: updatedChannel.org_id
                                                    }
                                                });
                                            } else {
                                                await this.broker.call("getstarted.updateGetStartedProgress", {
                                                    org_id: updatedChannel.org_id,
                                                    channel_created: true
                                                }, {
                                                    meta: {
                                                        org_id: updatedChannel.org_id
                                                    }
                                                });
                                            }
                                            this.logger.debug("Other active channels:", otherChannels.length);
                                        } catch (error) {
                                            this.logger.error("Error handling channel update:", error);
                                        }
                                    }, 1000);
                                }
                            } catch (error) {
                                this.logger.error("Error processing channel update:", error);
                            }
                        }
                    } else if (change.operationType === "delete") {
                        const deletedChannel = change.documentKey;
                        this.logger.info("Channel deleted:", deletedChannel);
                    }
                });

                // Add error handling and reconnection logic
                this.changeStream.on("error", async (error) => {
                    this.logger.error("ChangeStream error:", error);
                });

                // Handle connection close
                this.changeStream.on("close", () => {
                    this.logger.info("ChangeStream closed, attempting to reconnect...");
                });

                this.logger.info("ChangeStream setup completed successfully");

            } catch (error) {
                this.logger.error("Error setting up ChangeStream:", error);
            }
        }
    },
    created() {
        // Lifecycle event handler
    },
    started() {
        this.setupChangeStream();
    },
    stopped() {
        if (this.changeStream) {
            try {
                this.changeStream.close();
            } catch (closeError) {
                this.logger.error("Error closing ChangeStream:", closeError);
            }
        }
    }
};