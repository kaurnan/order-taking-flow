const WhatsApp = require("whatsapp");
const { FormatPhoneNumber } = require("../../utils/common");
const { default: axios } = require("axios");
const dbMixin = require("../../mixins/db.mixin");
const { ObjectId } = require("mongodb");
const { parsePhoneNumber } = require("awesome-phonenumber");
const countryList = require("countries-list");
const { MoleculerError } = require("moleculer").Errors;
const channelModel = require("../../models/channel.model");
const FormData = require("form-data");
const BusinessHours = require("../../models/chat/businesshour.model");
const QuickReply = require("../../models/chat/quickreply.model");
const organisationModel = require("../../models/ums/organisation.model");
const customerModel = require("../../models/customer.model");
const BulkDeleteJob = require("../../models/bulk_delete_job.model");
const templateDeleteQueue = require("../../queues/template_delete.queue");
const path = require('path'); // Added for path manipulation
const dotenv = require("dotenv");

dotenv.config();

"use strict";

console.log(process.env.WA_PHONE_NUMBER_ID);

module.exports = {
    name: "whatsapp",
    mixins: [dbMixin("whatsapptemplate")],
    /**
     * Service settings
     */
    settings: {
        // Add your service settings here

    },

    /**
     * Actions
     */
    actions: {

        /**
         * Get business hours for an organisation
         */
        getBusinessHours: {
            auth: "required",
            async handler(ctx) {
                const { org_id } = ctx.meta;
                if (
                    !(
                        ctx.meta.scopes.includes("conversation_write") ||
                        ctx.meta.scopes.includes("conversation_read") ||
                        ctx.meta.scopes.includes("full_control")
                    )
                ) {
                    throw new MoleculerError("You do not have permission to access business hours", 403, "FORBIDDEN");
                }
                if (!org_id) {
                    throw new MoleculerError("org_id is required", 400, "ORG_ID_REQUIRED");
                }
                // Assuming BusinessHours is imported and available
                const record = await BusinessHours.findOne({ org_id: new ObjectId(org_id) }).populate("quick_reply");
                return {
                    success: true,
                    message: "Business hours fetched successfully",
                    data: record,
                };
            },
        },

        /**
         * Update business hours for an organisation.
         */
        updateBusinessHours: {
            auth: "required",
            rest: "PUT /business-hours",
            params: {
                id: { type: "string", min: 24, max: 24 },
                awaymsg: { type: "string", optional: true },
                awaymsg_enabled: { type: "boolean", optional: true },
                greetingmsg: { type: "string", optional: true },
                greetingmsg_enabled: { type: "boolean", optional: true },
                bussiness_hours: { type: "object", optional: true }
            },
            async handler(ctx) {
                const { id, awaymsg, awaymsg_enabled, greetingmsg, greetingmsg_enabled, bussiness_hours } = ctx.params;

                // Validate if business hours exist
                const existingBusinessHours = await BusinessHours.findById(id);
                if (!existingBusinessHours) {
                    throw new MoleculerError("Business hours not found.", 404, "NOT_FOUND");
                }

                const updateFields = {};

                if (awaymsg !== undefined) updateFields.awaymsg = awaymsg;
                if (awaymsg_enabled !== undefined) updateFields.awaymsg_enabled = awaymsg_enabled;
                if (greetingmsg !== undefined) updateFields.greetingmsg = greetingmsg;
                if (greetingmsg_enabled !== undefined) updateFields.greetingmsg_enabled = greetingmsg_enabled;

                if (bussiness_hours) {
                    for (const day in bussiness_hours) {
                        const dayHours = bussiness_hours[day];
                        if (
                            dayHours.stime &&
                            dayHours.etime &&
                            dayHours.stime >= dayHours.etime
                        ) {
                            throw new MoleculerError(`Invalid hours for ${day}: Start time must be before end time.`, 400, "INVALID_HOURS");
                        }
                    }
                    updateFields.bussiness_hours = bussiness_hours;
                }

                if (Object.keys(updateFields).length === 0) {
                    throw new MoleculerError("No valid fields provided for update.", 400, "NO_FIELDS");
                }

                const updatedBusinessHours = await BusinessHours.findByIdAndUpdate(
                    id,
                    updateFields,
                    { new: true, runValidators: true }
                );

                return {
                    success: true,
                    message: "Settings updated successfully",
                    data: updatedBusinessHours,
                };
            }
        },

        /**
         * Create a new WhatsApp template
         * @param {Object} ctx.params - Template details
         */
        createTemplate: {
            auth: "required",
            rest: "POST /templates",
            params: {
                name: { type: "string", min: 3, max: 100 },
                language: { type: "string", default: "en" },
                category: { type: "string" },
                components: { type: "array", items: { type: "object" } }
            },
            async handler(ctx) {
                const { name, language, category, components } = ctx.params;
                const { org_id } = ctx.meta;
                const waba_accounts = await channelModel.aggregate([
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

                const existing = await this.adapter.model.findOne({ org_id, name });
                if (existing) {
                    throw new MoleculerError("Template with this name already exists", 400, "TEMPLATE_EXISTS");
                }

                if (!waba_accounts || waba_accounts.length === 0) {
                    throw new MoleculerError("No WABA accounts found for this organisation", 404, "WABA_NOT_FOUND");
                }

                const meta_templates = waba_accounts.map(waba => {
                    let temp_id = `temp_${waba._id}_${Date.now()}`;
                    this.createMetaTemplates({
                        name,
                        language,
                        category,
                        components
                    }, waba._id, temp_id, org_id);
                    return {
                        waba_id: waba._id,
                        id: temp_id, // Temporary ID for the template
                        name,
                        language,
                        category,
                        components,
                        status: "pending"
                    };
                });

                const template = await this.adapter.model.create({
                    org_id,
                    name,
                    meta_templates
                });

                return {
                    success: true,
                    message: "Template created successfully",
                    data: template
                };
            },
        },



        /**
         * Delete multiple WhatsApp templates by IDs - Optimized with queue-based processing.
         */
        deleteMultipleTemplates: {
            auth: "required",
            rest: "DELETE /templates/bulk",
            params: {
                ids: {
                    type: "array",
                    items: { type: "string" },
                    min: 1,
                    max: 150 // Limit to prevent abuse
                }
            },
            async handler(ctx) {
                const { ids } = ctx.params;
                const { org_id } = ctx.meta;

                if (!ids || ids.length === 0) {
                    throw new MoleculerError("Template IDs are required", 400, "IDS_REQUIRED");
                }

                // Validate that all templates belong to the current organisation
                const templates = await this.adapter.model.find({
                    _id: { $in: ids.map(id => new ObjectId(id)) },
                    org_id: new ObjectId(org_id)
                });

                if (templates.length !== ids.length) {
                    throw new MoleculerError("Some templates not found or you do not have permission to delete them", 404, "TEMPLATES_NOT_FOUND");
                }

                // Generate unique job ID
                const jobId = `bulk_delete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Create bulk delete job record
                const bulkDeleteJob = new BulkDeleteJob({
                    jobId,
                    org_id: new ObjectId(org_id),
                    templateIds: ids,
                    progress: {
                        total: ids.length,
                        completed: 0,
                        failed: 0,
                        successful: 0
                    },
                    results: templates.map(template => ({
                        templateId: template._id.toString(),
                        name: template.name,
                        status: 'pending'
                    })),
                    metadata: {
                        initiatedBy: ctx.meta.user?.id || 'unknown',
                        userAgent: ctx.meta.userAgent,
                        ipAddress: ctx.meta.ipAddress
                    }
                });

                await bulkDeleteJob.save();

                // Add jobs to queue for background processing
                const queueJobs = templates.map(template => ({
                    name: 'delete-template',
                    data: {
                        templateId: template._id.toString(),
                        org_id,
                        jobId
                    },
                    opts: {
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 2000
                        },
                        removeOnComplete: 50,
                        removeOnFail: 25
                    }
                }));

                // Add all jobs to queue
                await templateDeleteQueue.addBulk(queueJobs);

                return {
                    success: true,
                    message: "Bulk delete operation initiated successfully",
                    data: {
                        jobId,
                        totalTemplates: ids.length,
                        status: "pending",
                        progress: {
                            total: ids.length,
                            completed: 0,
                            failed: 0,
                            successful: 0
                        },
                        estimatedTime: `${Math.ceil(ids.length / 5)} minutes`, // Based on 5 concurrent workers
                        checkStatusUrl: `/api/whatsapp/bulk-delete-status/${jobId}`
                    }
                };
            }
        },

        /**
         * Get status of bulk delete operation
         */
        getBulkDeleteStatus: {
            auth: "required",
            rest: "GET /bulk-delete-status/:jobId",
            params: {
                jobId: { type: "string", min: 1 }
            },
            async handler(ctx) {
                const { jobId } = ctx.params;
                const { org_id } = ctx.meta;

                const bulkDeleteJob = await BulkDeleteJob.findOne({
                    jobId,
                    org_id: new ObjectId(org_id)
                });

                if (!bulkDeleteJob) {
                    throw new MoleculerError("Bulk delete job not found", 404, "JOB_NOT_FOUND");
                }

                return {
                    success: true,
                    data: {
                        jobId: bulkDeleteJob.jobId,
                        status: bulkDeleteJob.status,
                        progress: bulkDeleteJob.progress,
                        results: bulkDeleteJob.results,
                        startedAt: bulkDeleteJob.startedAt,
                        completedAt: bulkDeleteJob.completedAt,
                        error: bulkDeleteJob.error
                    }
                };
            }
        },

        /**
         * Cancel bulk delete operation
         */
        cancelBulkDelete: {
            auth: "required",
            rest: "POST /bulk-delete-cancel/:jobId",
            params: {
                jobId: { type: "string", min: 1 }
            },
            async handler(ctx) {
                const { jobId } = ctx.params;
                const { org_id } = ctx.meta;

                const bulkDeleteJob = await BulkDeleteJob.findOne({
                    jobId,
                    org_id: new ObjectId(org_id)
                });

                if (!bulkDeleteJob) {
                    throw new MoleculerError("Bulk delete job not found", 404, "JOB_NOT_FOUND");
                }

                if (bulkDeleteJob.status === 'completed' || bulkDeleteJob.status === 'failed') {
                    throw new MoleculerError("Cannot cancel completed or failed job", 400, "JOB_ALREADY_COMPLETED");
                }

                // Update job status to cancelled
                bulkDeleteJob.status = 'cancelled';
                bulkDeleteJob.completedAt = new Date();
                await bulkDeleteJob.save();

                // Note: Individual jobs in the queue will continue to process
                // but will be marked as cancelled when they try to update progress

                return {
                    success: true,
                    message: "Bulk delete operation cancelled successfully",
                    data: {
                        jobId,
                        status: 'cancelled'
                    }
                };
            }
        },

        /**
         * Update bulk delete progress (called by worker)
         */
        updateBulkDeleteProgress: {
            async handler(ctx) {
                const { jobId, templateId, status, message, error } = ctx.params;

                const bulkDeleteJob = await BulkDeleteJob.findOne({ jobId });
                if (!bulkDeleteJob) {
                    console.error(`Bulk delete job ${jobId} not found`);
                    return;
                }

                // Check if job was cancelled
                if (bulkDeleteJob.status === 'cancelled') {
                    console.log(`Job ${jobId} was cancelled, skipping template ${templateId}`);
                    return;
                }

                // Update template result
                await bulkDeleteJob.updateTemplateResult(templateId, status, message, error);

                // Check if job is completed and send notification
                if (bulkDeleteJob.status === 'completed' || bulkDeleteJob.status === 'failed') {
                    try {
                        const successfulCount = bulkDeleteJob.progress.successful;
                        const failedCount = bulkDeleteJob.progress.failed;
                        const totalTemplates = bulkDeleteJob.progress.total;

                        // Determine notification template based on job status
                        let templateKey = "bulk_template_delete_completed";
                        if (bulkDeleteJob.status === 'failed') {
                            templateKey = "bulk_template_delete_failed";
                        }

                        // Send notification for bulk delete completion
                        await ctx.call("notification.sendNotification", {
                            templateKey,
                            variables: {
                                totalTemplates,
                                successfulCount,
                                failedCount
                            },
                            additionalData: {
                                organisation_id: bulkDeleteJob.org_id.toString(),
                                user_id: bulkDeleteJob.metadata.initiatedBy
                            }
                        });

                        console.log(`Bulk delete notification sent for job ${jobId} with status: ${bulkDeleteJob.status}`);
                    } catch (notificationError) {
                        console.error(`Failed to send bulk delete notification for job ${jobId}:`, notificationError);
                    }
                }

                return {
                    success: true,
                    message: "Progress updated successfully"
                };
            }
        },

        /**
         * Fetch whatsapp templates with number pagination and filtering options.
         * @param {Object} ctx - The context object containing parameters.
        */
        listTemplates: {
            auth: "required",
            rest: "GET /templates",
            params: {
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                search: { type: "string", optional: true },
                status: { type: "string", optional: true, enum: ["APPROVED", "PENDING", "REJECTED", "IN_REVIEW", "ERROR"] },
                language: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { pageSize, page, search, status, language } = ctx.params;
                const { org_id } = ctx.meta;
                const query = {
                    org_id: org_id,
                };
                const skip = (parseInt(page) - 1) * parseInt(pageSize);
                if (search) query.name = { $regex: search, $options: "i" };
                if (status) {
                    // Filter templates where at least one meta_templates entry matches the status
                    query["meta_templates.status"] = status;
                }
                if (language) {
                    query["meta_templates.language"] = language;
                }
                const [total, templates] = await Promise.all([
                    this.adapter.model.countDocuments(query),
                    this.adapter.model.find(query).skip(skip).limit(parseInt(pageSize)).sort({ _id: -1 })
                ]);

                return {
                    success: true,
                    message: "Templates fetched successfully",
                    data: templates,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pageSize,
                        totalPages: Math.ceil(total / pageSize),
                    },
                };
            }
        },

        getTemplateById: {
            auth: "required",
            rest: "GET /templates/:id",
            params: {
                id: { type: "string", min: 24, max: 24 }
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const template = await this.adapter.model.findById(id);
                if (!template) {
                    throw new MoleculerError("Template not found", 404, "NOT_FOUND");
                }
                return {
                    success: true,
                    message: "Template fetched successfully",
                    data: template
                };
            }
        },

        /**
         * Verify WhatsApp webhook subscription.
         */
        verifyWebhook: {
            rest: "GET /wa-webhook",
            params: {
                "hub.mode": { type: "string", optional: true },
                "hub.challenge": { type: "string", optional: true },
                "hub.verify_token": { type: "string", optional: true }
            },
            async handler(ctx) {
                const mode = ctx.params["hub.mode"];
                const token = ctx.params["hub.verify_token"];
                const challenge = ctx.params["hub.challenge"];
                ctx.meta.$responseHeaders = {
                    "Content-Type": "text/plain",
                    "Transfer-Encoding": "chunked"
                };

                if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFICATION_TOKEN) {
                    ctx.meta.$statusCode = 200;
                    ctx.meta.$responseAvailable = true;
                    console.log("Webhook subscription request successfully verified");
                    return challenge;
                } else {
                    const errorMessage = "Webhook subscription request has either missing or non-matching verify token";
                    ctx.meta.$statusCode = 403;
                    console.error(errorMessage);
                    return errorMessage;
                }
            }
        },

        MarkasRead: {
            auth: "required",
            params: {
                contact_id: { type: "number" }, // Contact ID from the audience
                channel_id: { type: "string" }, // Channel ID for the message
                to: { type: "string" }, // Phone number in E.164 format
                message_id: { type: "string" } // Message ID to mark as read
            },
            async handler(ctx) {
                console.log("Marking message as read", JSON.stringify(ctx.params));
                const { contact_id, channel_id, to, message_id } = ctx.params;
                const channel = ctx.meta.channel;

                if (channel.bsp === "gupshup") {
                    // Mark message as read via Gupshup
                    const payload = {
                        to,
                        contact_id,
                        channel_id,
                        message_id
                    };
                    console.log("Payload for Gupshup:", payload);
                    return ctx.call("gupshup.markAsRead", payload, { meta: { scopes: ["gupshup_write"] } });
                }
                else if (channel.bsp === "interakt") {
                    // Mark message as read via Interakt
                    const payload = {
                        wabaId: channel.waba_id,
                        phoneNumberId: channel.phone_number_details.id,
                        messageId: message_id
                    };
                    console.log("Payload for Interakt:", payload);
                    return ctx.call("interakt.markAsRead", payload, { meta: { scopes: ["interakt_write"] } });
                }
            }
        },

        /**
         * Sending message via BSP (Business Service Provider).
         * Using Gupshup or Interakt based on the channel configuration.
         */
        SendMsgViaBSP: {
            auth: false, // Disabled for testing catalogue messaging
            params: {
                to: { type: "string", min: 10, max: 15 }, // Phone number in E.164 format
                contact_id: { type: "number", optional: true }, // Contact ID from the audience
                message_type: { type: "string", enum: ["text", "image", "video", "audio", "template", "document", "interactive", "location"] }, // Type of message to send
                meta_payload: { type: "object" }, // Payload containing message details
                channel_id: { type: "string", optional: true }, // Channel ID for the message
                channel: { type: "object", optional: true, props: { bsp: { type: "string", enum: ["gupshup", "interakt"] }, waba_id: { type: "string", optional: true } } }, // Channel configuration
                template_data: { type: "object", optional: true }, // Template data for template messages
                broadcastId: { type: "string", optional: true }, // Add broadcastId
            },
            async handler(ctx) {
                const channel = ctx.meta.channel;
                const { to, message_type, meta_payload, context, template_data, broadcastId } = ctx.params;

                let payload = {
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": to,
                    "type": message_type,
                    [message_type]: {
                        "preview_url": true,
                        "body": meta_payload?.body || meta_payload.text || meta_payload.link || "",
                    }
                };

                if (message_type === "interactive") {
                    payload.interactive = meta_payload;
                }

                if (message_type === "location") {
                    if (meta_payload?.longitude && meta_payload?.latitude) {
                        payload.location = meta_payload;
                    }
                }

                if (message_type === "template") {
                    if (!template_data) {
                        throw new MoleculerError("Template data is required for template messages", 400, "TEMPLATE_DATA_REQUIRED");
                    }
                    // Simply use the template structure with parameters - no complex processing
                    payload.template = {
                        name: meta_payload.name,
                        language: meta_payload.language,
                        components: template_data.components
                    };
                }

                if (message_type === "image" || message_type === "video" || message_type === "audio" || message_type === "document") {
                    if (!meta_payload?.link) {
                        throw new MoleculerError("Media is required for media messages", 400, "MEDIA_REQUIRED");
                    }
                    payload[message_type] = {
                        "link": meta_payload.link
                    };
                    if (meta_payload.caption) {
                        payload[message_type].caption = meta_payload.caption;
                    }
                }

                /**
                 * Include context if available
                 */
                if (context) {
                    payload.context = context;
                }

                let response;
                if (channel.bsp === "gupshup") {
                    response = await this.sendMessageViaBsp(channel.waba_id, channel.phone_number_details.id, payload, "gupshup", {
                        appId: channel.additional.app_id,
                        token: channel.additional.token
                    });
                }
                else if (channel.bsp === "interakt") {
                    response = await this.sendMessageViaBsp(channel.waba_id, channel.phone_number_details.id, payload, "interakt");
                }

                if (response.success && response.data.messages && response.data.messages.length > 0) {

                    // Clone meta_payload and include id from response
                    const payloadWithId = {
                        ...payload,
                        id: response.data.messages[0].id
                    };
                    delete payloadWithId.messaging_product;
                    delete payloadWithId.recipient_type;
                    this.handleConversation(ctx, payloadWithId, { profile: { name: null, wa_id: to } }, channel, FormatPhoneNumber(to), "outbound", broadcastId);
                }
                return response;

            }
        },

        /**
         * Create a new media ID for WhatsApp messages.
         */
        CreateMediaID: {
            auth: "required",
            rest: "POST /create-media-id",
            async handler(ctx) {
                try {
                    console.log(ctx.params);
                    console.log(ctx.meta);
                    const channel = ctx.meta.channel;
                    const form = new FormData();

                    form.append("messaging_product", "whatsapp");
                    form.append("file", ctx.params, {
                        filename: ctx.meta.filename,
                        contentType: ctx.meta.mimetype
                    });

                    console.log("FormData fields:");
                    form._streams.forEach((stream) => {
                        if (typeof stream === "string") {
                            console.log(stream);
                        }
                    });
                    let headers = {
                        "x-access-token": process.env.INTERAKT_TOKEN,
                        "x-waba-id": channel.waba_id,

                    };
                    console.log("Headers for media upload:", headers);
                    const response = await axios.post(
                        `${process.env.INTERAKT_API}/${channel.phone_number_details.id}/media`,
                        form,
                        {
                            headers: headers,
                        }
                    );
                    // const response = await ctx.call("interakt.uploadMedia", { wabaId: channel.waba_id, phoneNumberId: channel.phone_number_details.id, file: ctx.params, type: ctx.meta.mimetype }, { meta: { scopes: ["interakt_write"] } });
                    console.log("Media upload response:", response);
                    // console.log("Creating media ID for:", type);
                    // const mediaId = await this.client.messages.media.create(file, type);
                    // return { mediaId };
                } catch (error) {
                    console.error("Error uploading media:", error.response?.data || error.message);
                    console.log(error);
                }
            }
        },

        /**
         * Send whatsapp message using flowflex official WhatsApp number. mostly used for sending notificaitons to the
         * Clients, example sending export, account setup, forgot password, etc.
         */
        sendMessage: {
            params: {
                to: "string",
                body: "any",
                type: { type: "enum", values: ["text", "image", "video", "audio", "template"] },
            },
            async handler(ctx) {
                const { to, body, type } = ctx.params;
                console.log("Sending message to:", to);
                console.log("Message body:", body);
                if (type === "text") {
                    const sent_text_message = this.client.messages.text(body, to);
                    await sent_text_message.then((res) => {
                        return res.body;
                    });
                }
                else if (type === "template") {
                    const sent_template_message = this.client.messages.template(body, to);
                    await sent_template_message.then((res) => {
                        // console.log("Template message sent successfully:", res);
                        return res.body;
                    }).catch((err) => {
                        console.error("Error sending template message:", err);

                    });

                }

            }
        },

        /**
         * Send WhatsApp catalogue message
         * This sends an interactive message that displays the product catalogue
         */
        sendCatalogueMessage: {
            auth: "required",
            params: {
                to: "string",
                catalogueId: "string",
                message: { type: "string", optional: true, default: "Check out our latest products!" },
                thumbnailProductId: { type: "string", optional: true },
                channel_id: "string",
                channel: "object"
            },
            async handler(ctx) {
                const { to, catalogueId, message, thumbnailProductId, channel_id, channel } = ctx.params;

                try {
                    this.logger.info(`Sending catalogue message to ${to} with catalogue: ${catalogueId}`);

                    // Get a sample product for thumbnail if not provided
                    let productId = thumbnailProductId;
                    if (!productId) {
                        const catalogueProducts = await this.broker.call("meta-catalogue.getCatalogueProducts", {
                            catalogueId: catalogueId,
                            accessToken: channel.access_token || process.env.CLOUD_API_ACCESS_TOKEN,
                            limit: 1
                        });

                        if (catalogueProducts.success && catalogueProducts.products.length > 0) {
                            productId = catalogueProducts.products[0].retailer_id;
                        }
                    }

                    const payload = {
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": to,
                        "type": "interactive",
                        "interactive": {
                            "type": "catalog_message",
                            "body": {
                                "text": message
                            },
                            "action": {
                                "name": "catalog_message",
                                "parameters": {
                                    "thumbnail_product_retailer_id": productId
                                }
                            },
                            "footer": {
                                "text": "Happy Shopping!"
                            }
                        }
                    };

                    // Send via BSP (Interakt/Gupshup)
                    const result = await this.sendMessageViaBsp(
                        channel.waba_id,
                        channel.phone_number_id,
                        payload,
                        channel.bsp || "interakt",
                        {
                            appId: channel.app_id,
                            token: channel.token
                        }
                    );

                    if (result.success) {
                        this.logger.info(`Catalogue message sent successfully to ${to}`);
                        return {
                            success: true,
                            messageId: result.data?.messages?.[0]?.id,
                            phone: to,
                            catalogueId: catalogueId
                        };
                    } else {
                        throw new Error(result.message || "Failed to send catalogue message");
                    }

                } catch (error) {
                    this.logger.error("Error sending catalogue message:", error);
                    throw new MoleculerError(
                        `Failed to send catalogue message: ${error.message}`,
                        500,
                        "CATALOGUE_MESSAGE_ERROR"
                    );
                }
            }
        },

        /**
         * Send WhatsApp catalogue template message
         * This sends a pre-approved template that includes catalogue access
         */
        sendCatalogueTemplate: {
            auth: "required",
            params: {
                to: "string",
                templateName: "string",
                templateLanguage: { type: "string", default: "en" },
                catalogueId: "string",
                templateData: "object",
                channel_id: "string",
                channel: "object"
            },
            async handler(ctx) {
                const { to, templateName, templateLanguage, catalogueId, templateData, channel_id, channel } = ctx.params;

                try {
                    this.logger.info(`Sending catalogue template ${templateName} to ${to}`);

                    // Get a sample product for thumbnail
                    const catalogueProducts = await this.broker.call("meta-catalogue.getCatalogueProducts", {
                        catalogueId: catalogueId,
                        accessToken: channel.access_token || process.env.CLOUD_API_ACCESS_TOKEN,
                        limit: 1
                    });

                    let productId = null;
                    if (catalogueProducts.success && catalogueProducts.products.length > 0) {
                        productId = catalogueProducts.products[0].retailer_id;
                    }

                    const payload = {
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": to,
                        "type": "template",
                        "template": {
                            "name": templateName,
                            "language": {
                                "code": templateLanguage
                            },
                            "components": [
                                {
                                    "type": "body",
                                    "parameters": templateData.body_parameters || []
                                },
                                {
                                    "type": "button",
                                    "sub_type": "catalog",
                                    "index": "0",
                                    "parameters": [
                                        {
                                            "type": "catalog",
                                            "catalog_id": catalogueId,
                                            "product_retailer_id": productId
                                        }
                                    ]
                                }
                            ]
                        }
                    };

                    // Send via BSP
                    const result = await this.sendMessageViaBsp(
                        channel.waba_id,
                        channel.phone_number_id,
                        payload,
                        channel.bsp || "interakt",
                        {
                            appId: channel.app_id,
                            token: channel.token
                        }
                    );

                    if (result.success) {
                        this.logger.info(`Catalogue template sent successfully to ${to}`);
                        return {
                            success: true,
                            messageId: result.data?.messages?.[0]?.id,
                            phone: to,
                            templateName: templateName,
                            catalogueId: catalogueId
                        };
                    } else {
                        throw new Error(result.message || "Failed to send catalogue template");
                    }

                } catch (error) {
                    this.logger.error("Error sending catalogue template:", error);
                    throw new MoleculerError(
                        `Failed to send catalogue template: ${error.message}`,
                        500,
                        "CATALOGUE_TEMPLATE_ERROR"
                    );
                }
            }
        },

        /**
         * Handle incoming webhook events from WhatsApp Business API.
         * This action processes incoming messages, template status updates, and other events.
         */
        handleWebhook: {
            rest: "POST /webhook",
            params: {
                // Define your webhook parameters here
            },
            async handler(ctx) {
                if (ctx.params.object === "whatsapp_business_account") {
                    ctx.params.entry.forEach(entry => {
                        const changes = entry.changes;
                        changes.forEach(async change => {
                            switch (change.field) {
                                case "messages":
                                    if (change.value && change.value.messages && Array.isArray(change.value.messages)) {
                                        const message = change.value.messages[0];
                                        const contact = change.value.contacts[0];
                                        const metadata = change.value.metadata;
                                        const channel = await this.getChannel(metadata.phone_number_id);
                                        if (!channel) {
                                            console.error("Channel not found");
                                            return "EVENT_RECEIVED-NO_CHANNEL";
                                        }
                                        const formatPhone = FormatPhoneNumber(contact.wa_id);
                                        this.handleConversation(ctx, message, contact, channel, formatPhone, "inbound");
                                        this.handleAudienceAddition(ctx, contact, channel, formatPhone);

                                        // Handle catalogue order messages
                                        if (message.type === "order") {
                                            this.handleCatalogueOrder(ctx, message, contact, channel, formatPhone);
                                        }

                                        // Handle interactive messages (catalogue interactions)
                                        if (message.type === "interactive" && message.interactive?.type === "catalog_message") {
                                            this.handleCatalogueInteraction(ctx, message, contact, channel, formatPhone);
                                        }

                                        // Handle user preferences update for STOP/START messages
                                        if (message.type === "text" && (message.text.body.toLowerCase() === "stop" || message.text.body.toLowerCase() === "start")) {
                                            const userPreferencesValue = message.text.body.toLowerCase() === "stop" ? "stop" : "resume";
                                            const userPreferencesPayload = {
                                                contacts: [{ wa_id: contact.wa_id }],
                                                metadata: { phone_number_id: metadata.phone_number_id },
                                                user_preferences: [{
                                                    wa_id: contact.wa_id,
                                                    category: "marketing_messages",
                                                    value: userPreferencesValue
                                                }]
                                            };
                                            this.handleUserPreferencesUpdate(ctx, userPreferencesPayload, entry.id);
                                        }
                                    }
                                    else if (change.value && change.value.statuses && Array.isArray(change.value.statuses)) {
                                        const status = change.value.statuses[0];
                                        if (status?.type == "set-callback") {
                                            return "EVENT_RECEIVED-SET-CALLBACK";
                                        }
                                        const metadata = change.value.metadata;
                                        if (!metadata?.phone_number_id) {
                                            return;
                                        }
                                        const channel = await this.getChannel(metadata.phone_number_id);
                                        if (!channel) {
                                            console.error("Channel not found");
                                            return "EVENT_RECEIVED-NO_CHANNEL";
                                        }
                                        this.handleMessageStatusUpdate(ctx, status);
                                    }
                                    return "EVENT_RECEIVED-MESSAGE";
                                case "message_template_status_update":
                                    this.handleTemplateStatusUpdate(ctx, change.value, entry.id);
                                    return "EVENT_RECEIVED-TEMPLATE_STATUS_UPDATE";
                                case "phone_number_quality_update":
                                    this.handleChannelStatusUpdate(ctx, change.value, entry.id);
                                    return "EVENT_RECEIVED-PHONENUMBER-QUALITY-UPDATE";
                                case 'user_preferences':
                                    this.handleUserPreferencesUpdate(ctx, change.value, entry.id);
                                    return "EVENT_RECEIVED-USER-PREFERENCES";
                                default:
                                    return "EVENT_RECEIVED-UNHANDLED";
                            }
                        });
                    });
                }
                console.log(JSON.stringify(ctx.params));
                return "EVENT_RECEIVED";
            }
        },

    },

    /**
     * Events
     */
    events: {
        // Add your event listeners here
        "send.message": {
            async handler(ctx) {
                try {
                    const { org_id, phone, channel, customer_id, name, template, broadcastId } = ctx.params;

                    let contact = await this.broker.call("supabase.getLatestConversation", {
                        org_id,
                        session: phone,
                        channel_id: channel,
                    });

                    if (!contact) {
                        let Contactpayload = {
                            assigned_to: "unassigned",
                            email: "",
                            session: phone,
                            org_id,
                            customer_id,
                            name,
                            updated_at: new Date(),
                            session_status: "active",
                            unread_count: 0,
                            channel_id: channel,
                            status: "open",
                        }
                        contact = await this.broker.call("supabase.insertData", { table: "contacts_moleculer", payload: Contactpayload });
                    }

                    const templateData = await this.broker.call("whatsapp.getTemplateById", {
                        id: template.template_id,
                    });

                    await this.broker.call("whatsapp.SendMsgViaBSP", {
                        to: phone,
                        contact_id: contact?.id,
                        message_type: 'template',
                        meta_payload: template?.template_json,
                        channel_id: channel,
                        template_data: templateData?.data?.meta_templates?.[0],
                        broadcastId
                    }).then(result => {
                        return result;
                    }).catch(err => {
                        console.error("Error sending message:", err);
                        return err;
                    });

                    return 'message sent initiated';
                } catch (err) {
                    console.error("Action error:", err);
                    return err;
                }
            }
        }
    },

    /**
     * Methods
     */

    methods: {


        async sendMessageViaBsp(wabaId, phoneNumberId, payload, bsp = "interakt", options = {}) {
            try {
                const strategies = {
                    gupshup: async () => {
                        const { appId, token } = options;
                        if (!appId || !token) throw new Error("Missing required Gupshup options");

                        const url = `${process.env.GUPSHUP_PARTNER_API}/partner/app/${appId}/v3/message`;
                        const headers = { Authorization: token };
                        const response = await axios.post(url, payload, { headers });
                        return response.data;
                    },
                    interakt: async () => {
                        const url = `${process.env.INTERAKT_API}/${phoneNumberId}/messages`;
                        const headers = {
                            "x-access-token": process.env.INTERAKT_TOKEN,
                            "x-waba-id": wabaId,
                            "Content-Type": "application/json"
                        };
                        const response = await axios.post(url, payload, { headers });
                        return response.data;
                    }
                };

                const data = await (strategies[bsp] || strategies["interakt"])();
                return { success: true, message: "Message sent successfully", data };

            } catch (error) {
                const errMsg = error?.response?.data?.error || error?.response?.data || error.message;
                this.logger?.error?.("Error sending message via", bsp, ":", errMsg);
                return { success: false, message: "Failed to send message", error: errMsg };
            }
        },

        /**
         * Create a new message template in WhatsApp Business API.
         * @param {*} payload 
         * @param {*} waba_id 
         * @param {*} temp_id 
         */
        async createMetaTemplates(payload, waba_id, temp_id, org_id) {
            try {
                // Process components to upload media if present in the header
                for (const component of payload.components) {
                    if (component.type === "HEADER" && (component.format === "IMAGE" || component.format === "VIDEO")) {
                        const mediaUrl = component.example?.header_handle?.[0];
                        if (mediaUrl) {
                            this.logger.info(`Downloading media from CDN: ${mediaUrl}`);
                            const { buffer, file_length, file_type } = await this.downloadMediaFromCDN(mediaUrl);
                            console.log("Media downloaded successfully:", { file_length, file_type });
                            const fileName = path.basename(new URL(mediaUrl).pathname);
                            this.logger.info(`Uploading media to Meta: ${fileName}`);
                            console.log("Uploading media to Meta:", { fileName, file_length, file_type, waba_id });
                            const handleId = await this.uploadMediaToMeta(waba_id, fileName, file_length, file_type, buffer);

                            if (handleId) {
                                component.example.header_handle = [handleId];
                                this.logger.info(`Media uploaded, handleID: ${handleId}`);
                            } else {
                                this.logger.error("Failed to get handleID for media upload.");
                                throw new MoleculerError("Failed to upload media for template header", 500, "MEDIA_UPLOAD_FAILED");
                            }
                        }
                    }
                }

                const response = await axios.post(
                    `https://graph.facebook.com/v23.0/${waba_id}/message_templates`,
                    payload,
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                if (response.data?.id) {
                    // If the template was created successfully, save it to the database
                    const updatedTemplate = await this.adapter.model.findOneAndUpdate(
                        { "meta_templates.id": temp_id },
                        {
                            $set: {
                                "meta_templates.$.id": response.data.id,
                                "meta_templates.$.status": response.data.status,
                                "meta_templates.$.category": response.data.category,
                            }
                        },
                        { new: true }
                    );

                    if (!updatedTemplate) {
                        console.error("Failed to update template in the database");
                    } else {
                        console.log("Template updated in the database:", updatedTemplate);
                    }
                }
            } catch (error) {
                console.error("Error creating meta template:", error.response?.data || error.message || error);

                // Handle specific Meta API errors
                const errorData = error.response?.data?.error;
                if (errorData) {
                    // Handle template language deletion error
                    if (errorData.error_subcode === 2388023) {
                        console.error("for. English content is being deleted and cannot be modified for 4 weeks.");

                        // Send notification about the error
                        await this.broker.call("notification.send", {
                            templateKey: "template_deletion_in_progress",
                            variables: {
                                templateName: payload.name,
                                retryAfter: "4 weeks"
                            },
                            additionalData: {
                                organisation_id: org_id
                            }
                        });
                    }
                    // Handle WhatsApp Business account restriction error
                    if (errorData.error_subcode === 3835016) {
                        console.error("WhatsApp Business account is restricted from creating new templates:", errorData.error_user_msg);

                        // Update template status to ERROR and store error message for specific WABA ID
                        await this.adapter.model.findOneAndUpdate(
                            { "meta_templates.id": temp_id },
                            {
                                $set: {
                                    "meta_templates.$.status": "ERROR",
                                    "meta_templates.$.error_msg": errorData.error_user_msg
                                }
                            },
                            { new: true }
                        );
                    }

                    // Handle other Meta API errors by setting status to ERROR
                    if (errorData.error_subcode && errorData.error_subcode !== 2388023 && errorData.error_subcode !== 3835016) {
                        console.error("Meta API error occurred:", errorData.error_user_msg || errorData.message);

                        // Update template status to ERROR and store error message for specific WABA ID
                        await this.adapter.model.findOneAndUpdate(
                            { "meta_templates.id": temp_id },
                            {
                                $set: {
                                    "meta_templates.$.status": "ERROR",
                                    "meta_templates.$.error_msg": errorData.error_user_msg || errorData.message || "Unknown Meta API error"
                                }
                            },
                            { new: true }
                        );
                    }
                }
            }
        },

        async handleAudienceAddition(ctx, contact, channel, formatPhone) {
            const org_id = channel.org_id?.toString();
            const phone = formatPhone;
            const name = contact?.profile?.name ?? formatPhone;

            // Check if the contact already exists in the audience
            const parsedNumber = parsePhoneNumber(formatPhone);
            const country = countryList.getCountryData(parsedNumber.regionCode);
            console.log("Country data:", country);
            const existingContact = await this.getContactFromAudience(ctx, org_id, phone);
            if (existingContact) {
                console.log("Contact already exists in audience:", existingContact);
                return existingContact;
            }

            // const parsedNumber = parsePhoneNumber(formatPhone);


            // If not, add the contact to the audience
            const addedContact = await this.addContactToAudience(ctx, org_id, phone, name, country?.name ?? null);
            if (addedContact) {
                console.log("Contact added to audience:", addedContact);
                return addedContact;
            }

            console.warn("Failed to add contact to audience");
            return null;
        },

        async getChannel(phone_number_id) {
            try {
                const channel = await channelModel.findOne({ "phone_number_details.id": phone_number_id });
                if (channel) {
                    return channel;
                } else {
                    console.error("Channel not found or service provider not available");
                    return null;
                }
            } catch (error) {
                console.error("Error fetching channel type:", error);
                return null;
            }
        },

        async getContactFromAudience(ctx, org_id, phone) {
            try {
                console.log("heoooo", org_id, phone);
                const audience = await ctx.call("customer.getAudience", { organisation_id: org_id, phone });
                if (audience) {
                    console.log("Audience found:", audience);
                    return audience;
                }
                console.warn("Audience not found or no contacts available");
                return null;
            } catch (error) {
                console.error("Error fetching contact from audience:", error.message || error);
                return null;
            }
        },

        async addContactToAudience(ctx, org_id, phone, name, country = null) {
            try {
                console.log("Adding contact to audience:", org_id, phone, name);
                const branches = await ctx.call("branch.listBranchesByOrgId", {}, { meta: { org_id, scopes: ["branch_read"] } });
                if (!branches?.data || branches?.data.length === 0) {
                    console.error("No branches found for organisation:", org_id);
                    return null;
                }
                const branch = branches?.data[0]; // Assuming you want to use the first branch
                console.log("Using branch:", branch._id.toString());
                const audience = await ctx.call("customer.addAudience", { phone, name, addresses: [], country }, {
                    meta: {
                        org_id,
                        branch_id: branch._id.toString(),
                        scopes: ["customer_write"]
                    }
                });
                if (audience) {
                    console.log("Audience added:", audience);
                    return audience;
                }
                console.warn("Failed to add audience or no contacts available");
                return null;
            } catch (error) {
                console.error("Error adding contact to audience:", error.message || error);
                return null;
            }
        },

        async addContactToSupabase(ctx, payload) {
            try {
                const audience = await ctx.call("supabase.insertData", { table: "contacts_moleculer", payload });
                if (audience) {
                    console.log("Audience added:", audience);
                    return audience;
                }
                console.warn("Failed to add audience or no contacts available");
                return null;
            } catch (error) {
                console.error("Error adding contact to audience:", error.message || error);
                return null;
            }
        },

        async getContactFromSupabase(ctx, org_id, phone) {
            try {
                const audience = await ctx.call("supabase.getAudience", { organisation_id: org_id, phone });
                if (audience) {
                    console.log("Audience found:", audience);
                    return audience;
                }
                console.warn("Audience not found or no contacts available");
                return null;
            } catch (error) {
                console.error("Error fetching contact from audience:", error.message || error);
                return null;
            }
        },

        async handleOptOut(ctx, payload) {
            try {
                const { phone } = payload;
                const { org_id } = ctx.meta;
                const audience = await ctx.call("supabase.getAudience", { organisation_id: org_id, phone });
                if (audience) {
                    console.log("Audience found:", audience);
                    return audience;
                }
                console.warn("Audience not found or no contacts available");
                return null;
            } catch (error) {
                console.error("Error fetching contact from audience:", error.message || error);
                return null;
            }
        },

        async GenerateLastMsg(payload) {
            switch (payload.type) {
                case "image":
                    return "Image";
                case "sticker":
                    return "Sticker";
                case "video":
                    return "Video";
                case "text":
                    return payload.text?.body ?? payload.payload?.text ?? payload.payload?.body;
                default:
                    return "Unknown";
            }
        },


        /**
         * Handle the conversation and record it in the supabase database.
         * @param {*} ctx 
         * @param {*} message 
         * @param {*} contact 
         * @param {*} channel 
         * @param {*} formatPhone 
         * @returns 
         */
        async handleConversation(ctx, message, contact, channel, formatPhone, direction = "inbound", broadcastId = null) {
            try {

                /**
                 * Fetch the latest conversation for the given channel and phone number.
                 * This will help us determine if we need to create a new contact or update an existing one.
                 * customer_id is fetched from the last conversation or from the audience if not found.
                 */
                let lastConversation = await ctx.call("supabase.getLatestConversation", { org_id: channel.org_id?.toString(), session: formatPhone, channel_id: channel._id?.toString() });
                let customer_id = lastConversation?.customer_id ?? null;
                if (!customer_id) {
                    const contactFromAudience = await this.getContactFromAudience(ctx, channel.org_id?.toString(), formatPhone);
                    if (contactFromAudience) {
                        customer_id = contactFromAudience._id?.toString() ?? null;
                    }
                }

                /**
                 * Determine the agent to assign the conversation to.
                 */
                let agent;
                if (lastConversation?.assigned_to && lastConversation.assigned_to !== "unassigned") {
                    agent = lastConversation.assigned_to;
                } else {
                    try {
                        agent = await ctx.call("agent.getSmartAgent",
                            { org_id: channel.org_id?.toString(), phone: formatPhone },
                            {
                                meta: {
                                    org_id: channel.org_id?.toString(),
                                    scopes: ["full_control"] // Add required scopes
                                }
                            }
                        );
                    } catch (agentError) {
                        console.error("Error fetching agent:", agentError);
                        agent = null; // Fallback to no agent assignment
                    }
                }

                /**
                 * Handle the reaction to the message if it exists.
                 * This will update the reaction in the message payload. and store it in the database.
                 * return if the message type is reaction.
                 */
                if (message.type === "reaction") {
                    const currentMsg = await ctx.call("supabase.getDataByMessageId", { table: "messages_moleculer", message_id: message.reaction.message_id });
                    console.log("Current message for reaction:", currentMsg);
                    if (!currentMsg || currentMsg.length === 0) {
                        console.error("No message found for reaction:", message.reaction.message_id);
                        return;
                    }
                    let _message = currentMsg[0];
                    let previousReactions = _message.reaction;
                    if (previousReactions == null) {
                        _message = {
                            ..._message,
                            reaction: [
                                {
                                    user: "customer",
                                    emoji: message.reaction.emoji,
                                    status: "delivered",
                                    msg_id: message.message_id,
                                },
                            ],
                        };
                    }
                    else {
                        const existingReactionIndex = previousReactions.findIndex((reaction) => reaction.msg_id === message.reaction.message_id);
                        console.log(previousReactions);
                        if (existingReactionIndex !== -1) {
                            previousReactions[existingReactionIndex].emoji = message.reaction.emoji;
                        } else {
                            let _message = {
                                user: "customer",
                                emoji: message.reaction.emoji,
                                msg_id: message.message_id,
                                status: "delivered",
                            };
                            previousReactions.push(_message);
                        }
                        _message = {
                            ..._message,
                            reaction: previousReactions,
                        };
                    }
                    ctx.call("supabase.updateData", { table: "messages_moleculer", payload: _message, id: _message.id });
                    return;
                }

                /**
                 * Transform the incoming message to a standard format.
                 */
                message = await this.transformMessage(ctx, message);

                /**
                 * Create the contact payload to be stored in the database.
                 */
                let contactName;
                if (contact.profile.name === formatPhone) {
                    contactName = lastConversation?.name ?? contact?.profile?.name ?? formatPhone;
                } else {
                    contactName = contact?.profile?.name ?? lastConversation?.name ?? formatPhone;
                }

                let Contactpayload = {
                    assigned_to: agent?._id?.toString() ?? "unassigned",
                    email: lastConversation?.email ?? contact?.profile?.email ?? "",
                    session: formatPhone,
                    org_id: lastConversation?.org_id ?? channel.org_id?.toString(),
                    customer_id: lastConversation?.customer_id ?? customer_id ?? null,
                    name: contactName,
                    updated_at: new Date(),
                    session_status: "active",
                    unread_count: direction === "inbound"
                        ? (lastConversation?.unread_count ?? 0) + 1
                        : 0,
                    channel_id: channel._id?.toString() ?? "",
                    status: "open",
                };

                /**
                 * Create the message payload to be stored in the database.
                 */
                let Messagepayload = {
                    channel_id: channel._id?.toString() ?? "",
                    meta_payload: message, // store full message as JSON
                    search_text: message.text?.body ?? "",
                    message_id: message.id ?? null,
                    status: null,
                    updated_at: new Date(),
                    created_at: new Date(),
                    type: direction,
                    contact_id: lastConversation?.id ?? null, // should be bigint (Supabase contact id)
                    agent_id: agent?._id?.toString() ?? null,
                    reaction: null,
                    quick_reply: null,
                    is_private: false,
                    error: null,
                    flow_id: null,
                    org_id: channel.org_id?.toString(),
                    broadcast_id: broadcastId,
                };

                if (message.context && (message.context.id || message.context.message_id)) {
                    const contextMsgId = message.context.id || message.context.message_id;
                    const contextParent = await ctx.call("supabase.getDataByMessageId", { table: "messages_moleculer", message_id: contextMsgId });
                    console.log("Context parent message:", contextParent);
                    if (contextParent && contextParent.length > 0) {
                        // Check if this contact has already replied to this parent message
                        const existingReply = await ctx.call("supabase.getData", {
                            table: "messages_moleculer",
                            filters: {
                                contact_id: lastConversation?.id,
                                quick_reply: contextParent[0].id,
                                type: "inbound"
                            }
                        });

                        // Only set quick_reply if this is the first reply to this parent
                        if (!existingReply || existingReply.length === 0) {
                            Messagepayload.quick_reply = contextParent[0].id ?? null;
                            if (contextParent[0]?.broadcast_id) {
                                try {
                                    await ctx.call("broadcast_stats.updateBroadcastStats", {
                                        message_id: contextMsgId,
                                        status: 'replied',
                                        broadcast_id: contextParent[0].broadcast_id,
                                        error_details: null
                                    }, {
                                        meta: {
                                            org_id: channel._id?.toString() ?? "",
                                            channel_id: channel.org_id?.toString() ?? "",
                                        }
                                    });
                                } catch (broadcastError) {
                                    console.error("Error updating broadcast stats:", broadcastError);
                                }
                            }
                        } else {
                            console.log("Contact has already replied to this parent message, skipping quick_reply and broadcast stats update");
                        }
                    }
                }

                /**
                 * If no conversation exists, create a new contact and message in Supabase.
                 */
                if (!lastConversation) {
                    const Supabasecontact = await ctx.call("supabase.insertData", { table: "contacts_moleculer", payload: Contactpayload });
                    Messagepayload.contact_id = Supabasecontact?.id;
                    const Supabasemessage = await ctx.call("supabase.insertData", { table: "messages_moleculer", payload: Messagepayload });

                    if (!Supabasecontact || !Supabasemessage) {
                        console.error("Failed to add contact or message to Supabase", { Supabasecontact, Supabasemessage });
                        return;
                    }
                }
                /**
                 * If a conversation exists, update the contact and message in Supabase.
                 */
                else {
                    Contactpayload.assigned_to = lastConversation?.assigned_to !== "unassigned" ? lastConversation?.assigned_to ?? agent?.toString() : "unassigned";
                    if (direction === "inbound") {
                        Contactpayload.unread_count = (lastConversation?.unread_count ?? 0) + 1;
                    } else {
                        Contactpayload.unread_count = 0;
                    }
                    Contactpayload.updated_at = new Date();
                    Contactpayload.session_status = "active";
                    Contactpayload.status = "open";
                    console.log("Updating existing contact:", Contactpayload);
                    const [Supabasemessage, Supabasecontact] = await Promise.all([
                        ctx.call("supabase.insertData", { table: "messages_moleculer", payload: Messagepayload }),
                        ctx.call("supabase.updateData", { table: "contacts_moleculer", id: lastConversation.id, payload: Contactpayload })
                    ]);
                    if (!Supabasecontact || !Supabasemessage) {
                        console.error("Failed to update contact or add message to Supabase", { Supabasecontact, Supabasemessage });
                        return;
                    }
                    console.log("Contact updated in Supabase:", Supabasecontact);
                }

            } catch (error) {
                console.error(error);
                console.error("Error handling conversation:", error.message || error);
            }
        },

        async handleMessageStatusUpdate(ctx, status) {
            try {
                // Extract error details if present
                let errorDetails = null;
                let errorCode = null;
                if (status.errors && Array.isArray(status.errors) && status.errors.length > 0) {
                    errorDetails = status.errors[0]?.error_data?.details || status.errors[0]?.message || null;
                    errorCode = status.errors[0]?.code || null;
                }

                // Update message status and error - meta_msg_id is used for Gupshup, id is used for Interakt
                let message = null;
                if (status.gs_id) {
                    message = await ctx.call("supabase.getDataByMessageId", { table: "messages_moleculer", message_id: status.gs_id });
                }
                let messageIdToUpdate = status.meta_msg_id || status.id;

                // If message exists and status.meta_msg_id is present, update the message_id to meta_msg_id
                if (message && message.length > 0 && status.meta_msg_id) {
                    await ctx.call("supabase.updateData", {
                        table: "messages_moleculer",
                        message_id: status.gs_id,
                        payload: {
                            message_id: status.meta_msg_id
                        }
                    });
                }

                // Update message status in Supabase
                await ctx.call("supabase.updateData", {
                    table: "messages_moleculer",
                    message_id: messageIdToUpdate,
                    payload: {
                        status: status.status,
                        error: errorDetails
                    }
                });

                // Get the updated message to check if it's a broadcast message
                const updatedMessage = await ctx.call("supabase.getDataByMessageId", {
                    table: "messages_moleculer",
                    message_id: messageIdToUpdate
                });

                // If this is a broadcast message, update broadcast stats
                if (updatedMessage && updatedMessage.length > 0 && updatedMessage[0].broadcast_id) {
                    try {
                        await ctx.call("broadcast_stats.updateBroadcastStats", {
                            message_id: messageIdToUpdate,
                            status: status.status,
                            broadcast_id: updatedMessage[0].broadcast_id,
                            error_details: errorDetails ? { error_details: errorDetails, error_code: errorCode } : null
                        }, {
                            meta: {
                                org_id: updatedMessage[0].org_id,
                                channel_id: updatedMessage[0].channel_id,
                            }
                        });
                    } catch (broadcastError) {
                        console.error("Error updating broadcast stats:", broadcastError);
                    }
                }

                // If error code is 131047, update the contact session to expired
                if (errorCode === 131047) {
                    // Find the message to get the contact_id
                    const msg = await ctx.call("supabase.getDataByMessageId", { table: "messages_moleculer", message_id: status.id });
                    const contactId = msg && msg[0]?.contact_id;
                    if (contactId) {
                        await ctx.call("supabase.updateData", {
                            table: "contacts_moleculer",
                            id: contactId,
                            payload: {
                                session_status: "expired"
                            }
                        });
                    }
                }
            } catch (error) {
                console.error("Error handling message status update:", error.message || error);
            }
        },

        async handleTemplateStatusUpdate(ctx, value, waba_id) {
            try {
                const { message_template_name: template_name, event: status, message_template_id: template_id } = value;
                console.log("Template status update received:", { template_name, status, waba_id });

                // Find the template in the database
                const updatedTemplate = await this.adapter.model.findOneAndUpdate(
                    { "meta_templates.id": template_id },
                    { $set: { "meta_templates.$.status": status } },
                    { new: true }
                );

                if (!updatedTemplate) {
                    console.error("Template not found or update failed");
                    return;
                }

                console.log("Template status updated successfully:", updatedTemplate);

                // Create notification for template status update
                try {
                    const statusText = status.toLowerCase();
                    const statusDisplay = statusText.charAt(0).toUpperCase() + statusText.slice(1);

                    // Find the specific meta template to get additional details
                    const metaTemplate = updatedTemplate.meta_templates.find(template => template.id === template_id);
                    const wabaId = metaTemplate ? metaTemplate.waba_id : waba_id;
                    const category = metaTemplate ? metaTemplate.category : "Unknown";
                    const language = metaTemplate ? metaTemplate.language : "Unknown";

                    const statusIcon = await ctx.call("notification.getStatusIcon", { status });
                    await ctx.call("notification.send", {
                        templateKey: "whatsapp_template_status",
                        variables: {
                            templateName: template_name,
                            wabaId: wabaId,
                            category: category,
                            language: language,
                            status: statusDisplay.toLowerCase(),
                            statusIcon: statusIcon,
                            templateId: updatedTemplate._id
                        },
                        additionalData: {
                            organisation_id: updatedTemplate.org_id
                        }
                    });

                    console.log("Template status notification sent successfully");
                } catch (notificationError) {
                    console.error("Error sending template status notification:", notificationError.message || notificationError);
                }
            } catch (error) {
                console.error("Error handling template status update:", error.message || error);

                // Send notification for template status update error
                try {
                    const { message_template_name: template_name, event: status } = value;
                    await ctx.call("notification.send", {
                        templateKey: "whatsapp_template_error",
                        variables: {
                            templateName: template_name,
                            status: status
                        },
                        additionalData: {
                            organisation_id: waba_id // Using waba_id as fallback for org_id
                        }
                    });

                    console.log("Template status error notification sent successfully");
                } catch (notificationError) {
                    console.error("Error sending template status error notification:", notificationError.message || notificationError);
                }
            }
        },

        /**
         * Retrieve the Media URL from the WhatsApp message.
         */
        async getMediaUrl(ctx, mediaId) {
            try {
                // Step 1: Get media URL and MIME type
                const metaRes = await axios.get(
                    `https://graph.facebook.com/v14.0/${mediaId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`
                        }
                    }
                );
                const { url, mime_type } = metaRes.data;

                // Step 2: Download media to buffer
                const mediaRes = await axios.get(url, {
                    headers: {
                        Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`
                    },
                    responseType: "arraybuffer"
                });

                const buffer = Buffer.from(mediaRes.data);

                // Generate a clean filename (e.g., timestamp + extension)
                const extension = mime_type.split("/")[1] || "bin";
                const filename = `whatsapp-media/${mediaId}.${extension}`;
                console.log("Generated filename:", filename);
                // Step 3: Upload to GCS
                const uploadResponse = await ctx.call("gcp.uploadFile", {
                    bucket: process.env.GCP_BUCKET,
                    filename,
                    buffer,
                    contentType: mime_type,
                    metadata: {
                        filename
                    }
                });
                return uploadResponse?.url || null; // Return the URL of the uploaded file
            } catch (error) {
                console.error("Error fetching media URL:", error.message || error);
                return null;
            }
        },

        async transformMessage(ctx, message) {
            const start = Date.now();
            let result;
            switch (message.type) {
                case "text":
                    result = message;
                    break;
                case "audio":
                    result = {
                        ...message,
                        audio: {
                            ...message.audio,
                            audio: message.audio?.link || await this.getMediaUrl(ctx, message.audio.id)
                        }
                    };
                    break;
                case "image":
                    result = {
                        ...message,
                        image: {
                            ...message.image,
                            link: message.image?.link || await this.getMediaUrl(ctx, message.image.id)
                        }
                    };
                    break;
                case "video":
                    result = {
                        ...message,
                        video: {
                            ...message.video,
                            link: message.video?.link || await this.getMediaUrl(ctx, message.video.id)
                        }
                    };
                    break;
                case "document":
                    result = {
                        ...message,
                        document: {
                            ...message.document,
                            link: message.document?.link || await this.getMediaUrl(ctx, message.document.id)
                        }
                    };
                    break;
                case "sticker":
                    result = {
                        ...message,
                        sticker: {
                            ...message.sticker,
                            link: message.sticker?.link || await this.getMediaUrl(ctx, message.sticker.id)
                        }
                    };
                    break;
                case "file":
                    result = {
                        ...message,
                        file: {
                            ...message.file,
                            link: message.file?.link || await this.getMediaUrl(ctx, message.file.id)
                        }
                    };
                    break;
                default:
                    result = message;
            }
            const end = Date.now();
            console.log(`transformMessage executed in ${end - start}ms`);
            return result;
        },

        applyTemplateValues(templatedetails, payload) {
            // Handle both old format (payload.components) and new format (template_data.components)
            const templateComponents = payload.components || payload;
            
            const headerComponent = templatedetails.components.find((component) => component.type === "HEADER");
            const headerType = headerComponent?.parameters?.[0]?.type || "";
            let headerData = {};

            // Based on the header type, define how to extract data
            if (headerType === "image") {
                headerData = {
                    format: "IMAGE",
                    type: "HEADER",
                    data: headerComponent?.parameters?.[0]?.image?.link || "",
                };
            } else if (headerType === "sticker") {
                headerData = {
                    format: "sticker",
                    type: "HEADER",
                    data: headerComponent?.parameters?.[0]?.sticker?.link || "",
                };
            } else if (headerType === "file") {
                headerData = {
                    format: "file",
                    type: "HEADER",
                    data: {
                        link: headerComponent?.parameters?.[0]?.file?.link || "",
                        filename: headerComponent?.parameters?.[0]?.file?.link.split("/").pop() || "",
                    },
                };
            } else if (headerType === "document") {
                headerData = {
                    format: "document",
                    type: "HEADER",
                    data: {
                        link: headerComponent?.parameters?.[0]?.document?.link || "",
                        filename: headerComponent?.parameters?.[0]?.document?.link.split("/").pop() || "",
                    },
                };
            } else if (headerType === "audio") {
                headerData = {
                    format: "audio",
                    type: "HEADER",
                    data: headerComponent?.parameters?.[0]?.audio?.link || "",
                };
            } else if (headerType === "video") {
                headerData = {
                    format: "video",
                    type: "HEADER",
                    data: headerComponent?.parameters?.[0]?.video?.link || "",
                };
            } else if (headerType === "location") {
                headerData = {
                    format: "location",
                    type: "HEADER",
                    data: {
                        name: headerComponent?.parameters?.[0]?.location?.name || "",
                        address: headerComponent?.parameters?.[0]?.location?.address || ""
                    },
                };
            } else {
                headerData = { format: "TEXT", type: "HEADER", data: headerComponent?.parameters?.[0]?.text || "" };
            }

            // Extract body values from template_data.components (the parameter values)
            const bodyValues = templateComponents.components?.find((component) => component.type === "BODY")?.parameters?.map((param) => param.text) || [];

            // Extract the body template from templatedetails (the template structure)
            const bodyTemplate = templatedetails.components.find((component) => component.type === "BODY")?.text || "";

            // Create the body object in the required format
            const body = {
                type: "BODY",
                parameters: bodyValues, // Return the values that should replace the placeholders
            };
            const footer = templatedetails.components.find((component) => component.type === "FOOTER") || null;

            // Extract buttons from templatedetails
            const buttons = templatedetails.components.find((component) => component.type === "BUTTONS") || null;

            // Return the final object
            const result = [headerData, body];
            if (footer) {
                result.push(footer);
            }
            if (buttons) {
                result.push(buttons);
            }
            return result;
        },

        /**
         * Loading sample data to the collection.
         * It is called in the DB.mixin after the database
         * connection establishing & the collection is empty.
         */
        async seedDB() {
            await this.adapter.insertMany([
                {
                    org_id: new ObjectId("683d41c15fb092a0554fdf30"),
                    id: "template_1",
                    name: "welcome_message",
                    language: "en",
                    category: "greeting",
                    parameter_format: "Hi {{1}}, welcome to our service!",
                    components: [
                        {
                            examples: ["John Doe"],
                            type: "BODY",
                            text: "Hi {{1}}, welcome to our service!"
                        }
                    ],
                    status: "approved",
                    createdAt: new Date()
                },
                {
                    org_id: new ObjectId("60f7c0b8b4d1c2001c8d4e1a"),
                    id: "template_2",
                    name: "order_confirmation",
                    language: "en",
                    category: "transactional",
                    parameter_format: "Hello {{1}}, your order {{2}} has been confirmed.",
                    components: [
                        {
                            examples: ["John Doe", "12345"],
                            type: "BODY",
                            text: "Hello {{1}}, your order {{2}} has been confirmed."
                        }
                    ],
                    status: "approved",
                    createdAt: new Date()
                },
                {
                    org_id: new ObjectId("60f7c0b8b4d1c2001c8d4e1a"),
                    id: "template_3",
                    name: "otp_message",
                    language: "en",
                    category: "authentication",
                    parameter_format: "Your OTP is {{1}}.",
                    components: [
                        {
                            examples: ["123456"],
                            type: "BODY",
                            text: "Your OTP is {{1}}."
                        }
                    ],
                    status: "pending",
                    createdAt: new Date()
                }
            ]);
        },

        async handleChannelStatusUpdate(ctx, value, waba_id) {
            try {
                const { display_phone_number, event, current_limit } = value;
                if (!display_phone_number || !event || !current_limit) {
                    console.warn("Invalid phone_number_quality_update payload");
                    return;
                }
                // Find the channel by waba_id and display_phone_number
                const channel = await channelModel.findOne({
                    waba_id,
                    "phone_number_details.display_phone_number": display_phone_number
                });

                if (!channel) {
                    console.warn(`Channel not found for phone: ${display_phone_number}, WABA ID: ${waba_id}`);
                    return;
                }
                channel.phone_number_details.messaging_limit_tier = current_limit;
                await channel.save();
            } catch (error) {
                console.error(error);
            }
        },

        /**
         * Handle user preferences update from WhatsApp
         * @param {*} ctx 
         * @param {*} value 
         * @param {*} waba_id 
         * @returns 
         */
        async handleUserPreferencesUpdate(ctx, value, waba_id) {
            try {
                // Extract wa_id and user_preferences
                const wa_id = value.contacts?.[0]?.wa_id;
                const userPref = value.user_preferences?.find(
                    pref => pref.wa_id === wa_id && pref.category === "marketing_messages"
                );
                if (!wa_id || !userPref) {
                    console.warn("No wa_id or marketing_messages preference found in user_preferences update");
                    return;
                }
                // Determine consent value
                const consent = userPref.value === "stop" ? false : true;
                // Find org_id by phone_number_id
                const phone_number_id = value.metadata?.phone_number_id;
                const channel = await channelModel.findOne({ "phone_number_details.id": phone_number_id });
                if (!channel) {
                    console.warn("Channel not found for phone_number_id:", phone_number_id);
                    return;
                }
                const org_id = channel.org_id?.toString();
                // Update customer in audience (supabase) using direct model update
                const audience = await customerModel.findOne({ org_id: new ObjectId(org_id), phone: FormatPhoneNumber(wa_id) });
                if (!audience) {
                    console.warn("Audience not found for wa_id:", wa_id);
                    return;
                }
                await customerModel.updateOne(
                    { _id: new ObjectId(audience._id) },
                    { $set: { whatsapp_marketing_consent: consent } }
                );
                console.log(`Updated whatsapp_marketing_consent for ${wa_id} to ${consent}`);

                // Add system chat to the contact in supabase
                const supabaseContact = await ctx.call("supabase.getLatestConversation", { org_id: org_id, session: FormatPhoneNumber(wa_id), channel_id: channel._id?.toString() });
                console.log("Supabase contact:", supabaseContact);
                if (supabaseContact && supabaseContact.id) {
                    let systemMsg = "";
                    if (userPref.value === "stop") {
                        systemMsg = "Offers and announcements from channel is stopped by the user";
                    } else if (userPref.value === "resume") {
                        systemMsg = "Offers and announcements from channel is allowed by the user";
                    }
                    if (systemMsg) {
                        await ctx.call("supabase.insertData", {
                            table: "messages_moleculer",
                            payload: {
                                channel_id: channel._id?.toString() ?? "",
                                meta_payload:
                                {
                                    type: "text",
                                    payload: { body: systemMsg }
                                },
                                search_text: systemMsg,
                                message_id: new ObjectId().toString(),
                                status: null,
                                updated_at: new Date(),
                                created_at: new Date(),
                                type: "system",
                                contact_id: supabaseContact.id,
                                agent_id: null,
                                reaction: null,
                                quick_reply: null,
                                is_private: false,
                                error: null,
                                flow_id: null,
                                org_id: org_id,
                            }
                        });
                    }
                }
            } catch (error) {
                console.error("Error handling user preferences update:", error.message || error);
            }
        },

        async createBusinessHours(org_id) {
            try {
                // Check if business hours already exist for the branch
                const existingBusinessHours = await BusinessHours.findOne({ org_id: new ObjectId(org_id) });

                if (existingBusinessHours) {
                    return existingBusinessHours;
                }

                // Create a new quick reply
                const quickReply = new QuickReply({
                    org_id: new ObjectId(org_id),
                    reply: ["Hi there! 😊 How can we assist you today?, For pricing details, please visit our website or let us know what you're interested in!"],
                });
                await quickReply.save();

                // Create new business hours
                const businessHours = new BusinessHours({
                    org_id: new ObjectId(org_id),
                    quick_reply: quickReply._id,
                });
                await businessHours.save();

                console.log("Business hours created successfully.");
                return businessHours;
            } catch (error) {
                console.error("Error creating business hours:", error);
            }
        },

        async setupOrganisationChangeStream() {
            try {
                const OrganisationCollection = organisationModel.collection;
                if (!OrganisationCollection) {
                    this.logger.error("Collection organisations is not defined");
                    return;
                }

                // Close existing stream if it exists
                if (this.orgChangeStream) {
                    try {
                        this.orgChangeStream.close();
                    } catch (closeError) {
                        this.logger.error("Error closing Organisation ChangeStream:", closeError);
                    }
                }

                this.orgChangeStream = OrganisationCollection.watch();

                this.orgChangeStream.on("change", async (change) => {
                    this.logger.debug("Organisation change detected:", change);
                    try {
                        if (change.operationType === "update") {
                            const updatedOrgId = change.documentKey._id;
                            const updatedOrg = await organisationModel.findOne({ _id: updatedOrgId });
                            this.logger.info("Updated organisation:", updatedOrg);
                        } else if (change.operationType === "create") {
                            const newOrg = change.fullDocument;
                            await this.createBusinessHours(newOrg._id.toString());
                        } else if (change.operationType === "delete") {
                            const deletedOrg = change.documentKey;
                            this.logger.info("Organisation deleted:", deletedOrg);
                        }
                    } catch (error) {
                        this.logger.error("Error processing organisation change:", error);
                    }
                });

                // Add error handling and reconnection logic
                this.orgChangeStream.on("error", async (error) => {
                    this.logger.error("Organisation ChangeStream error:", error);

                });

                // Handle connection close
                this.orgChangeStream.on("close", () => {
                    this.logger.info("Organisation ChangeStream closed, attempting to reconnect...");
                });

                this.logger.info("Organisation ChangeStream setup completed successfully");

            } catch (error) {
                this.logger.error("Error setting up Organisation ChangeStream:", error);
            }
        },

        async setupWhatsAppTemplateChangeStream() {
            try {
                const collection = this.adapter.model.collection;
                if (!collection) {
                    this.logger.error("Collection whatsapptemplate is not defined");
                    return;
                }

                // Close existing stream if it exists
                if (this.changeStream) {
                    try {
                        this.changeStream.close();
                    } catch (closeError) {
                        this.logger.error("Error closing WhatsApp Template ChangeStream:", closeError);
                    }
                }

                this.changeStream = collection.watch();

                this.changeStream.on("change", async (change) => {
                    this.logger.debug("WhatsApp template change detected:", change);
                    try {
                        if (change.operationType === "update") {
                            const updatedTemplateId = change.documentKey._id;
                            const updatedTemplate = await this.adapter.findOne({ _id: updatedTemplateId });
                            this.logger.info("Updated template:", updatedTemplate);
                        } else if (change.operationType === "create") {
                            const newTemplate = change.fullDocument;
                            this.logger.info("New template created:", newTemplate);
                        } else if (change.operationType === "delete") {
                            const deletedTemplate = change.documentKey;
                            this.logger.info("Template deleted:", deletedTemplate);
                        }
                    } catch (error) {
                        this.logger.error("Error processing WhatsApp template change:", error);
                    }
                });

                // Add error handling and reconnection logic
                this.changeStream.on("error", async (error) => {
                    this.logger.error("WhatsApp template ChangeStream error:", error);

                });

                // Handle connection close
                this.changeStream.on("close", () => {
                    this.logger.info("WhatsApp template ChangeStream closed, attempting to reconnect...");
                });

                this.logger.info("WhatsApp template ChangeStream setup completed successfully");

            } catch (error) {
                this.logger.error("Error setting up WhatsApp template ChangeStream:", error);
            }
        },

        /**
         * Downloads a media file from a given CDN URL.
         * @param {string} url - The URL of the media file.
         * @returns {Object} An object containing the file buffer, length, and type.
         */
        async downloadMediaFromCDN(url) {
            try {
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);
                const file_length = buffer.length;
                const file_type = response.headers['content-type'];
                return { buffer, file_length, file_type };
            } catch (error) {
                this.logger.error(`Error downloading media from CDN: ${url}`, error.message || error);
                throw new MoleculerError("Failed to download media from CDN", 500, "CDN_DOWNLOAD_FAILED");
            }
        },

        /**
         * Uploads a media file to Meta and returns the handle ID.
         * @param {string} waba_id - The WABA ID.
         * @param {string} file_name - The name of the file.
         * @param {number} file_length - The length of the file in bytes.
         * @param {string} file_type - The MIME type of the file.
         * @param {Buffer} file_buffer - The buffer containing the file data.
         * @returns {string} The handle ID of the uploaded media.
         */
        async uploadMediaToMeta(waba_id, file_name, file_length, file_type, file_buffer) {
            try {
                // Step 1: Get upload session
                const sessionResponse = await axios.post(
                    `https://graph.facebook.com/v23.0/${process.env.FACEBOOK_APP_ID_FOR_WHATSAPP}/uploads`, {},
                    {
                        params: {
                            file_name,
                            file_length,
                            file_type,
                            access_token: process.env.CLOUD_API_ACCESS_TOKEN // Using CLOUD_API_ACCESS_TOKEN as clarified
                        },
                        headers: {
                            // Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                console.log("Upload session response:", sessionResponse.data);

                const { id: uploadSessionId } = sessionResponse.data;

                // Step 2: Upload file using the session
                const uploadResponse = await axios.post(
                    `https://graph.facebook.com/v23.0/${uploadSessionId}`,
                    file_buffer,
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`, // Using OAuth as per curl example
                            "file_offset": 0,
                            "Content-Type": file_type,
                        },
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                    }
                );

                console.log('Upload response:', uploadResponse.data);
                const { h: handleId } = uploadResponse.data;
                return handleId;

            } catch (error) {
                this.logger.error("Error uploading media to Meta:", error.response?.data || error.message || error);
                throw new MoleculerError("Failed to upload media to Meta", 500, "META_UPLOAD_FAILED");
            }
        },

        /**
         * Handle catalogue order from WhatsApp
         */
        async handleCatalogueOrder(ctx, message, contact, channel, formatPhone) {
            try {
                this.logger.info(`Processing catalogue order from ${formatPhone}`);

                const orderData = message.order;
                const customerData = {
                    phone: formatPhone,
                    name: contact.profile?.name || "Customer",
                    wa_id: contact.wa_id
                };

                // Find or create customer
                let customer = await this.broker.call("customer.findByPhone", {
                    phone: formatPhone
                }, {
                    meta: {
                        org_id: channel.org_id,
                        branch_id: channel.branch_id
                    }
                });

                if (!customer) {
                    customer = await this.broker.call("customer.create", {
                        name: customerData.name,
                        phone: formatPhone,
                        wa_id: contact.wa_id
                    }, {
                        meta: {
                            org_id: channel.org_id,
                            branch_id: channel.branch_id
                        }
                    });
                }

                // Process the order through order processor
                const orderResult = await this.broker.call("order-processor.processCatalogueOrder", {
                    orderData: orderData,
                    customerData: customer,
                    orgData: {
                        orgId: channel.org_id,
                        branchId: channel.branch_id
                    },
                    channelData: {
                        channelId: channel._id,
                        wabaId: channel.waba_id
                    }
                });

                this.logger.info(`Catalogue order processed: ${orderResult.orderId}`);

            } catch (error) {
                this.logger.error("Error handling catalogue order:", error);
            }
        },

        /**
         * Handle catalogue interaction (when customer views catalogue)
         */
        async handleCatalogueInteraction(ctx, message, contact, channel, formatPhone) {
            try {
                this.logger.info(`Processing catalogue interaction from ${formatPhone}`);

                const interactionData = message.interactive;
                
                // Log the interaction for analytics
                await this.broker.call("analytics.trackEvent", {
                    event: "catalogue_viewed",
                    customerPhone: formatPhone,
                    channelId: channel._id,
                    catalogueId: interactionData.catalog_id,
                    productId: interactionData.product_retailer_id,
                    timestamp: new Date()
                }, {
                    meta: {
                        org_id: channel.org_id,
                        branch_id: channel.branch_id
                    }
                });

                this.logger.info(`Catalogue interaction logged for ${formatPhone}`);

            } catch (error) {
                this.logger.error("Error handling catalogue interaction:", error);
            }
        }
    },

    hooks: {
        before: {
            SendMsgViaBSP: [
                async function validateSendMsgViaBSP(ctx) {
                    // Validate required fields
                    const { to, contact_id, message_type, meta_payload, channel_id } = ctx.params;
                    if (!to || !contact_id || !message_type || !meta_payload || !channel_id) {
                        throw new Error("Missing required parameters: to, contact_id, message_type, meta_payload, channel_id");
                    }

                    const channel = await channelModel.findOne({ _id: channel_id });
                    ctx.meta.channel = channel;
                    if (!channel) {
                        throw new Error("Channel not found");
                    }
                }
            ],
            MarkasRead: [
                async function validateMarkasRead(ctx) {
                    // Validate required fields
                    const { contact_id, channel_id } = ctx.params;
                    if (!contact_id || !channel_id) {
                        throw new Error("Missing required parameters: contact_id, channel_id");
                    }

                    const channel = await channelModel.findOne({ _id: channel_id });
                    ctx.meta.channel = channel;
                    if (!channel) {
                        throw new Error("Channel not found");
                    }
                }
            ],
            CreateMediaID: [
                async function validateCreateMediaID(ctx) {
                    const channel = await channelModel.findOne({ _id: ctx.meta.$params.channel });
                    ctx.meta.channel = channel;
                    if (!channel) {
                        throw new Error("Channel not found");
                    }
                }
            ]
        },
        after: {
            // Add your hooks here
        },
        error: {
            // Add your error handling hooks here
        }
    },

    /**
     * Service lifecycle events
     */
    created() {
        /**
         * Initialize WhatsApp client with the phone number ID.
         * This is used to send internal messages to the clients
         */
        this.client = new WhatsApp(process.env.WA_PHONE_NUMBER_ID);
    },

    async started() {
        try {
            this.setupOrganisationChangeStream();
            this.setupWhatsAppTemplateChangeStream();
        } catch (error) {
            this.logger.error("Error starting WhatsApp service:", error.message || error);
        }
        this.logger.info("WhatsApp service started");
    },

    stopped() {
        // Close all change streams when service stops
        if (this.orgChangeStream) {
            try {
                this.orgChangeStream.close();
            } catch (closeError) {
                this.logger.error("Error closing Organisation ChangeStream:", closeError);
            }
        }
        if (this.changeStream) {
            try {
                this.changeStream.close();
            } catch (closeError) {
                this.logger.error("Error closing WhatsApp Template ChangeStream:", closeError);
            }
        }
    },
};
