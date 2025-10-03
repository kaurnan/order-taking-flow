const axios = require("axios");
const { exchangeToken, FetchSharedWABAIDs, FetchPhoneNumbers, SubscribeAppToWaba, ADDSystemUserToWABA } = require("../../utils/common");
const FormData = require("form-data");
const channelModel = require("../../models/channel.model");

"use strict";

module.exports = {
    name: "interakt",
    actions: {
        /**
         * signup for Interakt
         */
        embededSignup: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/embeded_signup"
            },
            params: {
                code: "string",
            },
            async handler(ctx) {
                const { code } = ctx.params;

                try {
                    const exchangeTokenRes = await exchangeToken(code);
                    console.log("Access token:", exchangeTokenRes);
                    if (!exchangeTokenRes) {
                        throw new Error("Failed to exchange token");
                    }
                    const sharedWABAResponse = await FetchSharedWABAIDs(exchangeTokenRes?.access_token);
                    console.log("Shared WABA IDs:", JSON.stringify(sharedWABAResponse.data, null, 2));
                    const WABAID = sharedWABAResponse.data?.data?.granular_scopes.filter((scope) => scope.scope == "whatsapp_business_management")[0]?.target_ids[0];
                    if (!WABAID) {
                        throw new Error("Failed to fetch WABA ID");
                    }

                    const GetPhoneNumberResponse = await FetchPhoneNumbers(exchangeTokenRes?.access_token, WABAID);
                    console.log("GetPhoneNumberResponse:", JSON.stringify(GetPhoneNumberResponse.data, null, 2));

                    ADDSystemUserToWABA(WABAID).then(res => {
                        console.log("System user added to WABA successfully:", res.data);
                    }).catch(err => this.logger.error("Error adding system user to WABA:", err.message));
                    SubscribeAppToWaba(WABAID).then(res => {
                        console.log("App subscribed to WABA successfully:", res.data);
                    }).catch(err => this.logger.error("Error subscribing app to WABA:", err.message));
                    const channelObject = {
                        waba_id: WABAID,
                        websites: [],
                        email: "",
                        description: "",
                        address: "",
                        org_id: ctx.meta.org_id,
                        profile_picture_url: "",
                        phone_number_details: GetPhoneNumberResponse.data?.data[0],
                    };
                    console.log("Channel data:", JSON.stringify(channelObject, null, 2));

                    const isChannelExists = await channelModel.findOne({ "phone_number_details.id": channelObject.phone_number_details.id });
                    if (isChannelExists) {
                        this.logger.warn("Channel already exists with the same phone number details.");
                        return {
                            success: false,
                            message: "Channel already exists with the same phone number details.",
                            // data: isChannelExists
                        };
                    }

                    const channel = await ctx.call("channel.createChannel", channelObject);
                    return {
                        success: true,
                        message: "Embeded signup completed successfully",
                        data: channel
                    };
                } catch (error) {
                    console.error("Error in embeded signup:", error);
                    this.logger.error("Error in embeded signup:", error.message);
                    throw new Error("Failed to complete embeded signup");
                }
            }
        },

        /**
         * Handle incoming Interakt events
         */
        handleinterktEvents: {
            rest: {
                method: "POST",
                path: "/events"
            },
            params: {
                "hub.challenge": { type: "string", optional: true },
            },
            async handler() {
                // console.log("Received interakt event:", JSON.stringify(ctx.params, null, 2));
                return { success: true, message: "Event received" };
            }
        },

        /**
         * Challenge endpoint for Interakt webhook verification
         * This endpoint is used to verify the webhook subscription by returning the challenge parameter.
         */
        challengeinterktEvents: {
            rest: {
                method: "GET",
                path: "/events"
            },
            params: {
                "hub.challenge": "string"
            },
            async handler(ctx) {
                const { "hub.challenge": challenge } = ctx.params;
                ctx.meta.$statusCode = 200;
                ctx.meta.$responseType = "text/plain";
                return challenge;
            }
        },

        /**
         * Subscribe app to WABA for getting webhook events
         * @param {string} wabaId - The WABA ID
         * @param {string} accessToken - The access token for authentication
         * @param {string} overrideCallbackUri - The callback URL to override
         * @param {string} verifyToken - The verification token for the webhook
         */
        subscribeApp: {
            params: {
                wabaId: "string",
                accessToken: "string",
                overrideCallbackUri: "string",
                verifyToken: "string"
            },
            async handler(ctx) {
                const { wabaId, accessToken, overrideCallbackUri, verifyToken } = ctx.params;

                try {
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${wabaId}/subscribed_apps`,
                        {
                            override_callback_uri: overrideCallbackUri,
                            verify_token: verifyToken
                        },
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error subscribing app:", error.message);
                    throw new Error("Failed to subscribe app");
                }
            }
        },

        uploadMedia: {
            params: {
                phoneNumberId: "string",
                wabaId: "string",
                type: "string",
            },
            async handler(ctx) {
                const { phoneNumberId, wabaId, file, type } = ctx.params;
                console.log("files:", file);
                try {
                    const formData = new FormData();
                    const buffer = await this.streamToBuffer(file);

                    formData.append("messaging_product", "whatsapp");
                    formData.append("file", file, {
                        filename: file.name || "media",
                        contentType: type || "application/octet-stream"
                    });

                    console.log("Form Data Content:", buffer);
                    console.log("Form Data Headers:", formData.getHeaders());
                    console.log("Form Data Body:", formData);
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/media`,
                        formData,
                        {
                            headers: {
                                "x-access-token": process.env.INTERAKT_TOKEN,
                                "x-waba-id": wabaId,
                                ...formData.getHeaders()
                            }
                        }
                    );
                    console.log("Form Data Headers:", formData.getHeaders());
                    console.log("Form Data Body:", formData);
                    return response.data;
                } catch (error) {
                    console.error("Error uploading media:", error.response?.data || error.message);
                    this.logger.error("Error uploading media:", error.message);
                    throw new Error("Failed to upload media");
                }
            }
        },

        getCommerceSettings: {
            params: {
                phoneNumberId: "string",
                accessToken: "string",
                wabaId: "string"
            },
            async handler(ctx) {
                const { phoneNumberId, accessToken, wabaId } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/whatsapp_commerce_settings`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching commerce settings:", error.message);
                    throw new Error("Failed to fetch commerce settings");
                }
            }
        },

        updateCommerceSettings: {
            params: {
                phoneNumberId: "string",
                accessToken: "string",
                wabaId: "string",
                isCartEnabled: "boolean"
            },
            async handler(ctx) {
                const { phoneNumberId, accessToken, wabaId, isCartEnabled } = ctx.params;

                try {
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/whatsapp_commerce_settings?is_cart_enabled=${isCartEnabled}`,
                        {},
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error updating commerce settings:", error.message);
                    throw new Error("Failed to update commerce settings");
                }
            }
        },

        updateCatalogVisibility: {
            params: {
                phoneNumberId: "string",
                accessToken: "string",
                wabaId: "string",
                isCatalogVisible: "boolean"
            },
            async handler(ctx) {
                const { phoneNumberId, accessToken, wabaId, isCatalogVisible } = ctx.params;

                try {
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/whatsapp_commerce_settings?is_catalog_visible=${isCatalogVisible}`,
                        {},
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error updating catalog visibility:", error.message);
                    throw new Error("Failed to update catalog visibility");
                }
            }
        },

        getPhoneNumbers: {
            params: {
                wabaId: "string",
                accessToken: "string"
            },
            async handler(ctx) {
                const { wabaId, accessToken } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${wabaId}/phone_numbers`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching phone numbers:", error.message);
                    throw new Error("Failed to fetch phone numbers");
                }
            }
        },
        getPhoneNumberDetails: {
            params: {
                phoneNumberId: "string",
                accessToken: "string",
                wabaId: "string"
            },
            async handler(ctx) {
                const { phoneNumberId, accessToken, wabaId } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${phoneNumberId}?fields=status,is_official_business_account,id,name_status,code_verification_status,display_phone_number,platform_type,messaging_limit_tier,throughput`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching phone number details:", error.message);
                    throw new Error("Failed to fetch phone number details");
                }
            }
        },
        getBusinessProfile: {
            params: {
                phoneNumberId: "string",
                accessToken: "string",
                wabaId: "string"
            },
            async handler(ctx) {
                const { phoneNumberId, accessToken, wabaId } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching business profile:", error.message);
                    throw new Error("Failed to fetch business profile");
                }
            }
        },
        getHealthStatus: {
            params: {
                wabaId: "string",
                accessToken: "string"
            },
            async handler(ctx) {
                const { wabaId, accessToken } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${wabaId}?fields=health_status`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching health status:", error.message);
                    throw new Error("Failed to fetch health status");
                }
            }
        },
        updateBusinessProfile: {
            params: {
                phoneNumberId: "string",
                accessToken: "string",
                wabaId: "string",
                messagingProduct: "string",
                about: "string",
                address: "string",
                description: "string",
                vertical: "string",
                email: "string",
                websites: { type: "array", items: "string" },
                profilePictureHandle: "string"
            },
            async handler(ctx) {
                const {
                    phoneNumberId,
                    accessToken,
                    wabaId,
                    messagingProduct,
                    about,
                    address,
                    description,
                    vertical,
                    email,
                    websites,
                    profilePictureHandle
                } = ctx.params;

                try {
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/whatsapp_business_profile`,
                        {
                            messaging_product: messagingProduct,
                            about,
                            address,
                            description,
                            vertical,
                            email,
                            websites,
                            profile_picture_handle: profilePictureHandle
                        },
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error updating business profile:", error.message);
                    throw new Error("Failed to update business profile");
                }
            }
        },
        registerPhoneNumber: {
            params: {
                phoneNumberId: "string",
                accessToken: "string",
                wabaId: "string",
                messagingProduct: "string",
                pin: "string"
            },
            async handler(ctx) {
                const { phoneNumberId, accessToken, wabaId, messagingProduct, pin } = ctx.params;

                try {
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/register`,
                        {
                            messaging_product: messagingProduct,
                            pin
                        },
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error registering phone number:", error.message);
                    throw new Error("Failed to register phone number");
                }
            }
        },
        getAnalytics: {
            params: {
                wabaId: "string",
                accessToken: "string",
                start: "number",
                end: "number",
                granularity: "string"
            },
            async handler(ctx) {
                const { wabaId, accessToken, start, end, granularity } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${wabaId}?fields=analytics.start(${start}).end(${end}).granularity(${granularity})`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching analytics:", error.message);
                    throw new Error("Failed to fetch analytics");
                }
            }
        },
        getConversationAnalytics: {
            params: {
                wabaId: "string",
                accessToken: "string",
                start: "number",
                end: "number",
                granularity: "string",
                phoneNumbers: { type: "array", items: "string" },
                dimensions: { type: "array", items: "string" }
            },
            async handler(ctx) {
                const { wabaId, accessToken, start, end, granularity, phoneNumbers, dimensions } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${wabaId}?fields=conversation_analytics.start(${start}).end(${end}).granularity(${granularity}).phone_numbers(${JSON.stringify(phoneNumbers)}).dimensions(${JSON.stringify(dimensions)})`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching conversation analytics:", error.message);
                    throw new Error("Failed to fetch conversation analytics");
                }
            }
        },
        enableInsights: {
            params: {
                wabaId: "string",
                accessToken: "string"
            },
            async handler(ctx) {
                const { wabaId, accessToken } = ctx.params;

                try {
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${wabaId}?is_enabled_for_insights=true`,
                        {},
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error enabling insights:", error.message);
                    throw new Error("Failed to enable insights");
                }
            },

        },

        /**
            * Mark a message as read
            * @param {string} wabaId - The WABA ID
            * @param {string} messageId - The message ID
            */
        markAsRead: {
            params: {
                wabaId: "string",
                messageId: "string",
                phoneNumberId: "string"
            },
            async handler(ctx) {
                const { wabaId, messageId, phoneNumberId } = ctx.params;
                const accessToken = process.env.INTERAKT_TOKEN;

                try {
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${phoneNumberId}/messages`,
                        {
                            messaging_product: "whatsapp",
                            status: "read",
                            message_id: messageId
                        },
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    console.error("Error marking message as read:", error);
                    this.logger.error("Error marking message as read:", error.message);
                    throw new Error("Failed to mark message as read");
                }
            }
        },

        getTemplateAnalytics: {
            params: {
                wabaId: "string",
                accessToken: "string",
                start: "number",
                end: "number",
                granularity: "string",
                metricTypes: { type: "array", items: "string" },
                templateIds: { type: "array", items: "string" }
            },
            async handler(ctx) {
                const { wabaId, accessToken, start, end, granularity, metricTypes, templateIds } = ctx.params;

                try {
                    const response = await axios.get(
                        `${process.env.INTERAKT_API}/${wabaId}?fields=template_analytics.start(${start}).end(${end}).granularity(${granularity}).metric_types(${JSON.stringify(metricTypes)}).template_ids(${JSON.stringify(templateIds)})`,
                        {
                            headers: {
                                "x-access-token": accessToken,
                                "x-waba-id": wabaId,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    return response.data;
                } catch (error) {
                    this.logger.error("Error fetching template analytics:", error.message);
                    throw new Error("Failed to fetch template analytics");
                }
            }
        }
    },
    methods: {
        async streamToBuffer(stream) {
            return new Promise((resolve, reject) => {
                const chunks = [];
                stream.on("data", chunk => chunks.push(chunk));
                stream.on("end", () => resolve(Buffer.concat(chunks)));
                stream.on("error", err => reject(err));
            });
        }
    }
};