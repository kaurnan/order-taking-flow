"use strict";

const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;

module.exports = {
    name: "order-cancellation-template",
    mixins: [dbMixin("order_cancellation_templates")],
    
    settings: {
        // Template configuration
        defaultLanguage: "en",
        supportedLanguages: ["en", "es", "fr", "de"]
    },
    
    actions: {
        /**
         * Create order cancellation WhatsApp template
         */
        createOrderCancellationTemplate: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/order-cancellation-template"
            },
            params: {
                name: { type: "string", default: "order_cancellation" },
                language: { type: "string", default: "en" },
                orgId: "string",
                branchId: "string"
            },
            async handler(ctx) {
                const { name, language, orgId, branchId } = ctx.params;
                
                try {
                    // Template structure for WhatsApp Business API
                    const template = {
                        name: name,
                        language: language,
                        category: "UTILITY",
                        status: "PENDING", // Will be approved by WhatsApp
                        components: [
                            {
                                type: "HEADER",
                                format: "TEXT",
                                text: "Order Cancelled - {{1}}"
                            },
                            {
                                type: "BODY",
                                text: `Hello {{1}}! 👋

We're sorry to inform you that your order has been cancelled. 😔

📦 Order Details:
• Order Number: {{2}}
• Total Amount: {{3}}
• Items: {{4}}
• Cancellation Reason: {{5}}

💳 If you were charged, a full refund will be processed within 3-5 business days.

We apologize for any inconvenience. If you have any questions, please don't hesitate to contact us.

Thank you for your understanding! 💙`
                            },
                            {
                                type: "FOOTER",
                                text: "Need help? Contact us anytime!"
                            }
                        ],
                        org_id: orgId,
                        branch_id: branchId,
                        created_at: new Date(),
                        updated_at: new Date()
                    };
                    
                    // Save template to database
                    const savedTemplate = await this.adapter.insert(template);
                    
                    // Submit template to WhatsApp for approval
                    const approvalResult = await this.submitTemplateForApproval(savedTemplate);
                    
                    return {
                        success: true,
                        message: "Order cancellation template created successfully",
                        data: {
                            template: savedTemplate,
                            approvalStatus: approvalResult
                        }
                    };
                    
                } catch (error) {
                    this.logger.error("Error creating order cancellation template:", error);
                    throw new MoleculerError("Failed to create template", 500, "TEMPLATE_CREATION_ERROR");
                }
            }
        },

        /**
         * Send order cancellation WhatsApp message
         */
        sendOrderCancellationMessage: {
            rest: {
                method: "POST",
                path: "/send-order-cancellation"
            },
            params: {
                orderData: "object",
                customerData: "object",
                orgId: "string",
                branchId: "string"
            },
            async handler(ctx) {
                const { orderData, customerData, orgId, branchId } = ctx.params;
                
                try {
                    // Create template parameters
                    const templateParams = this.generateCancellationTemplateParameters(orderData, customerData);
                    
                    // Find available WhatsApp channel
                    const availableChannel = await this.findAvailableWhatsAppChannel(orgId);
                    if (!availableChannel) {
                        throw new Error("No WhatsApp channel available");
                    }

                    // Call WhatsApp service to send the message
                    const result = await this.broker.call("whatsapp.SendMsgViaBSP", {
                        to: customerData.phone,
                        // contact_id is optional - using customer's database ID if available, otherwise omit
                        ...(customerData._id && { contact_id: parseInt(customerData._id.toString().slice(-8), 16) }),
                        message_type: "template",
                        meta_payload: {
                            name: "order_cancellation",
                            language: "en",
                            components: [
                                {
                                    type: "header",
                                    parameters: [
                                        {
                                            type: "text",
                                            text: `Order #${orderData.order_number || orderData.name}`
                                        }
                                    ]
                                },
                                {
                                    type: "body",
                                    parameters: templateParams
                                }
                            ]
                        },
                        channel_id: availableChannel._id.toString(),
                        channel: {
                            bsp: "interakt",
                            waba_id: availableChannel.waba_id
                        }
                    });
                    
                    return {
                        success: true,
                        message: "Order cancellation message sent successfully",
                        data: result
                    };
                    
                } catch (error) {
                    this.logger.error("Error sending order cancellation message:", error);
                    throw new MoleculerError("Failed to send message", 500, "MESSAGE_SEND_ERROR");
                }
            }
        },
        
        /**
         * Get order cancellation template
         */
        getOrderCancellationTemplate: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/order-cancellation-template/:id"
            },
            params: {
                id: "string"
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const { orgId, branchId } = ctx.meta;
                
                try {
                    const template = await this.adapter.findById(id);
                    
                    if (!template || template.org_id !== orgId || template.branch_id !== branchId) {
                        throw new MoleculerError("Template not found", 404, "TEMPLATE_NOT_FOUND");
                    }
                    
                    return {
                        success: true,
                        data: template
                    };
                    
                } catch (error) {
                    this.logger.error("Error getting template:", error);
                    throw new MoleculerError("Failed to get template", 500, "TEMPLATE_GET_ERROR");
                }
            }
        },
        
        /**
         * Update template status
         */
        updateTemplateStatus: {
            auth: "required",
            rest: {
                method: "PUT",
                path: "/order-cancellation-template/:id/status"
            },
            params: {
                id: "string",
                status: { 
                    type: "enum", 
                    values: ["PENDING", "APPROVED", "REJECTED", "DISABLED"] 
                }
            },
            async handler(ctx) {
                const { id, status } = ctx.params;
                const { orgId, branchId } = ctx.meta;
                
                try {
                    const template = await this.adapter.findById(id);
                    
                    if (!template || template.org_id !== orgId || template.branch_id !== branchId) {
                        throw new MoleculerError("Template not found", 404, "TEMPLATE_NOT_FOUND");
                    }
                    
                    const updatedTemplate = await this.adapter.updateById(id, {
                        $set: {
                            status: status,
                            updated_at: new Date()
                        }
                    });
                    
                    return {
                        success: true,
                        message: "Template status updated successfully",
                        data: updatedTemplate
                    };
                    
                } catch (error) {
                    this.logger.error("Error updating template status:", error);
                    throw new MoleculerError("Failed to update template status", 500, "TEMPLATE_UPDATE_ERROR");
                }
            }
        }
    },
    
    methods: {
        /**
         * Submit template to WhatsApp for approval
         */
        async submitTemplateForApproval(template) {
            try {
                // This would integrate with WhatsApp Business API
                // For now, we'll simulate the approval process
                
                const approvalData = {
                    templateId: template._id,
                    status: "PENDING",
                    submittedAt: new Date(),
                    estimatedApprovalTime: "24-48 hours"
                };
                
                // In a real implementation, you would:
                // 1. Call WhatsApp Business API to submit the template
                // 2. Handle the webhook response for approval status
                // 3. Update the template status in your database
                
                this.logger.info("Cancellation template submitted for approval:", approvalData);
                
                return approvalData;
                
            } catch (error) {
                this.logger.error("Error submitting template for approval:", error);
                throw error;
            }
        },
        
        /**
         * Generate template parameters for order cancellation data
         */
        generateCancellationTemplateParameters(orderData, customerData) {
            return [
                {
                    type: "text",
                    text: customerData.name || "Valued Customer"
                },
                {
                    type: "text",
                    text: orderData.order_number || orderData.name
                },
                {
                    type: "text",
                    text: `${orderData.currency} ${orderData.total_price}`
                },
                {
                    type: "text",
                    text: orderData.line_items?.map(item => `${item.name} (Qty: ${item.quantity})`).join(', ') || 'No items'
                },
                {
                    type: "text",
                    text: orderData.cancel_reason || "Not specified"
                }
            ];
        },
        
        /**
         * Validate template parameters
         */
        validateTemplateParameters(parameters) {
            if (!Array.isArray(parameters)) {
                throw new Error("Template parameters must be an array");
            }
            
            if (parameters.length < 5) {
                throw new Error("Order cancellation template requires at least 5 parameters");
            }
            
            return true;
        },

        /**
         * Find available WhatsApp channel for organization
         */
        async findAvailableWhatsAppChannel(orgId) {
            try {
                // Get channels directly from the database to avoid authentication issues
                const channels = await this.broker.call("channel.getChannelsDirect", {
                    orgId: orgId
                });

                if (!channels || !channels.data || channels.data.length === 0) {
                    this.logger.warn(`No channels found for org: ${orgId}`);
                    return null;
                }

                // Use specific channel ID: 684b0f27325b7471155bf081
                const specificChannelId = "684b0f27325b7471155bf081";
                const whatsappChannel = channels.data.find(channel => 
                    channel._id.toString() === specificChannelId &&
                    channel.deleted !== true
                );

                if (!whatsappChannel) {
                    this.logger.warn(`Specific channel ${specificChannelId} not found for org: ${orgId}`);
                    return null;
                }

                this.logger.info(`Using specific WhatsApp channel: ${whatsappChannel._id} (BSP: ${whatsappChannel.bsp}, Phone: ${whatsappChannel.phone_number_details?.display_phone_number}) for org: ${orgId}`);
                return whatsappChannel;

            } catch (error) {
                this.logger.error("Error finding WhatsApp channel:", error);
                return null;
            }
        }
    },
    
    events: {
        /**
         * Handle template approval webhook from WhatsApp
         */
        "whatsapp.template.approved": {
            async handler(ctx) {
                const { templateId, status } = ctx.params;
                
                try {
                    await this.adapter.updateById(templateId, {
                        $set: {
                            status: status,
                            approved_at: new Date(),
                            updated_at: new Date()
                        }
                    });
                    
                    this.logger.info(`Cancellation template ${templateId} status updated to ${status}`);
                    
                } catch (error) {
                    this.logger.error("Error updating template approval status:", error);
                }
            }
        }
    },
    
    created() {
        this.logger.info("Order Cancellation Template service created");
    },
    
    started() {
        this.logger.info("Order Cancellation Template service started");
    },
    
    stopped() {
        this.logger.info("Order Cancellation Template service stopped");
    }
};

