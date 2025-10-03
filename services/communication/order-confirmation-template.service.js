"use strict";

const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;

module.exports = {
    name: "order-confirmation-template",
    mixins: [dbMixin("order_confirmation_templates")],
    
    settings: {
        // Template configuration
        defaultLanguage: "en",
        supportedLanguages: ["en", "es", "fr", "de"]
    },
    
    actions: {
        /**
         * Create order confirmation WhatsApp template
         */
        createOrderConfirmationTemplate: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/order-confirmation-template"
            },
            params: {
                name: { type: "string", default: "order_confirmation" },
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
                                text: "Order Confirmation - {{1}}"
                            },
                            {
                                type: "BODY",
                                text: `Hello {{1}}! 👋

Your order has been confirmed! 🎉

📦 Order Details:
• Order Number: {{2}}
• Total Amount: {{3}}
• Items: {{4}}

🚚 We'll send you tracking information once your order ships.

Thank you for choosing us! 💙`
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
                        message: "Order confirmation template created successfully",
                        data: {
                            template: savedTemplate,
                            approvalStatus: approvalResult
                        }
                    };
                    
                } catch (error) {
                    this.logger.error("Error creating order confirmation template:", error);
                    throw new MoleculerError("Failed to create template", 500, "TEMPLATE_CREATION_ERROR");
                }
            }
        },

        /**
         * Send order confirmation WhatsApp message
         */
        sendOrderConfirmationMessage: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/send-order-confirmation"
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
                    const templateParams = this.generateTemplateParameters(orderData, customerData);
                    
                    // Call WhatsApp service to send the message
                    const result = await this.broker.call("whatsapp.SendMsgViaBSP", {
                        to: customerData.phone,
                        message_type: "template",
                        meta_payload: {
                            name: "order_confirmation",
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
                        template_data: {
                            name: "order_confirmation",
                            language: "en"
                        }
                    });
                    
                    return {
                        success: true,
                        message: "Order confirmation message sent successfully",
                        data: result
                    };
                    
                } catch (error) {
                    this.logger.error("Error sending order confirmation message:", error);
                    throw new MoleculerError("Failed to send message", 500, "MESSAGE_SEND_ERROR");
                }
            }
        },
        
        /**
         * Get order confirmation template by ID
         */
        getOrderConfirmationTemplate: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/order-confirmation-template/:id"
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
         * Get order confirmation template by name
         */
        getOrderConfirmationTemplateByName: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/order-confirmation-template-by-name"
            },
            params: {
                name: { type: "string", default: "order_confirmation" },
                orgId: "string",
                branchId: "string"
            },
            async handler(ctx) {
                const { name, orgId, branchId } = ctx.params;
                
                try {
                    // First try to find in order_confirmation_templates collection
                    let template = await this.adapter.findOne({
                        name: name,
                        org_id: orgId,
                        branch_id: branchId
                    });
                    
                    if (!template) {
                        // If not found, try to find in whatsapptemplate collection
                        this.logger.info(`Template not found in order_confirmation_templates, checking whatsapptemplate collection...`);
                        
                        const WhatsAppTemplate = require("../../models/whatsapptemplate.model");
                        
                        // First, let's see what templates exist
                        const allWhatsappTemplates = await WhatsAppTemplate.find({
                            org_id: orgId
                        });
                        this.logger.info(`Found ${allWhatsappTemplates.length} WhatsApp templates for org ${orgId}:`);
                        allWhatsappTemplates.forEach((wt, index) => {
                            this.logger.info(`  ${index + 1}. ${wt.name} (${wt.status}) - ${wt._id}`);
                            if (wt.meta_templates && wt.meta_templates.length > 0) {
                                wt.meta_templates.forEach((meta, metaIndex) => {
                                    this.logger.info(`     Meta ${metaIndex + 1}: ${meta.status} (${meta.language}) - ID: ${meta.id}`);
                                });
                            }
                        });
                        
                        const whatsappTemplate = await WhatsAppTemplate.findOne({
                            name: name,
                            org_id: orgId,
                            "meta_templates.status": { $in: ["approved", "APPROVED"] }
                        });
                        
                        if (whatsappTemplate && whatsappTemplate.meta_templates && whatsappTemplate.meta_templates.length > 0) {
                            // Convert whatsapptemplate format to our expected format
                            // Try to use the second approved template (Meta 3) instead of the first one
                            const approvedMetaTemplates = whatsappTemplate.meta_templates.filter(mt => mt.status === "approved" || mt.status === "APPROVED");
                            const approvedMetaTemplate = approvedMetaTemplates[1] || approvedMetaTemplates[0]; // Use second approved template if available
                            
                            if (approvedMetaTemplate) {
                                // Clean the components to remove only 'example' field that causes API errors
                                // Keep 'text' field as it's needed for template processing
                                const cleanedComponents = approvedMetaTemplate.components ? 
                                    approvedMetaTemplate.components.map(component => {
                                        const cleaned = { ...component };
                                        // Remove only 'example' field as it's not expected by WhatsApp API
                                        // Keep 'text' field for template processing
                                        delete cleaned.example;
                                        return cleaned;
                                    }) : [];
                                
                                template = {
                                    name: whatsappTemplate.name,
                                    language: approvedMetaTemplate.language,
                                    category: approvedMetaTemplate.category,
                                    status: approvedMetaTemplate.status,
                                    components: cleanedComponents,
                                    org_id: whatsappTemplate.org_id,
                                    branch_id: branchId, // Use the provided branchId
                                    whatsapp_template_id: approvedMetaTemplate.id,
                                    _id: whatsappTemplate._id
                                };
                                
                                this.logger.info(`Found approved WhatsApp template: ${template.name} (${template._id})`);
                                this.logger.info(`Cleaned components (removed 'example' field, kept 'text' for template processing): ${JSON.stringify(cleanedComponents, null, 2)}`);
                                this.logger.info(`Original meta template components: ${JSON.stringify(approvedMetaTemplate.components, null, 2)}`);
                            }
                        }
                    }
                    
                    if (!template) {
                        this.logger.warn(`Template not found: name=${name}, orgId=${orgId}, branchId=${branchId}`);
                        return null;
                    }
                    
                    this.logger.info(`Found template: ${template.name} (${template._id})`);
                    return template;
                    
                } catch (error) {
                    this.logger.error("Error getting template by name:", error);
                    return null;
                }
            }
        },
        
        /**
         * List all available templates
         */
        listAllTemplates: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/list-all-templates"
            },
            params: {
                orgId: "string"
            },
            async handler(ctx) {
                const { orgId } = ctx.params;
                
                try {
                    this.logger.info(`Fetching all templates for org: ${orgId}`);
                    
                    // Check order_confirmation_templates collection
                    const orderConfirmationTemplates = await this.adapter.find({
                        org_id: orgId
                    });
                    
                    // Check whatsapptemplate collection
                    const WhatsAppTemplate = require("../../models/whatsapptemplate.model");
                    const whatsappTemplates = await WhatsAppTemplate.find({
                        org_id: orgId
                    });
                    
                    const result = {
                        orderConfirmationTemplates: orderConfirmationTemplates || [],
                        whatsappTemplates: whatsappTemplates || [],
                        summary: {
                            orderConfirmationCount: orderConfirmationTemplates?.length || 0,
                            whatsappTemplateCount: whatsappTemplates?.length || 0,
                            totalTemplates: (orderConfirmationTemplates?.length || 0) + (whatsappTemplates?.length || 0)
                        }
                    };
                    
                    this.logger.info(`Found ${result.summary.orderConfirmationCount} order confirmation templates and ${result.summary.whatsappTemplateCount} WhatsApp templates`);
                    
                    return {
                        success: true,
                        data: result
                    };
                    
                } catch (error) {
                    this.logger.error("Error listing templates:", error);
                    throw new MoleculerError("Failed to list templates", 500, "TEMPLATE_LIST_ERROR");
                }
            }
        },

        /**
         * Check specific template by name
         */
        checkTemplateByName: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/check-template/:name"
            },
            params: {
                name: "string",
                orgId: "string"
            },
            async handler(ctx) {
                const { name, orgId } = ctx.params;
                
                try {
                    this.logger.info(`Checking template: ${name} for org: ${orgId}`);
                    
                    // Check order_confirmation_templates collection
                    const orderConfirmationTemplate = await this.adapter.findOne({
                        name: name,
                        org_id: orgId
                    });
                    
                    // Check whatsapptemplate collection
                    const WhatsAppTemplate = require("../../models/whatsapptemplate.model");
                    const whatsappTemplate = await WhatsAppTemplate.findOne({
                        name: name,
                        org_id: orgId
                    });
                    
                    const result = {
                        templateName: name,
                        foundInOrderConfirmation: !!orderConfirmationTemplate,
                        foundInWhatsAppTemplate: !!whatsappTemplate,
                        orderConfirmationTemplate: orderConfirmationTemplate,
                        whatsappTemplate: whatsappTemplate,
                        hasApprovedTemplate: false
                    };
                    
                    // Check if there's an approved template
                    if (whatsappTemplate && whatsappTemplate.meta_templates) {
                        const approvedTemplate = whatsappTemplate.meta_templates.find(mt => 
                            mt.status === "approved" || mt.status === "APPROVED"
                        );
                        result.hasApprovedTemplate = !!approvedTemplate;
                        result.approvedTemplate = approvedTemplate;
                    }
                    
                    this.logger.info(`Template ${name} - OrderConfirmation: ${result.foundInOrderConfirmation}, WhatsApp: ${result.foundInWhatsAppTemplate}, Approved: ${result.hasApprovedTemplate}`);
                    
                    return {
                        success: true,
                        data: result
                    };
                    
                } catch (error) {
                    this.logger.error("Error checking template:", error);
                    throw new MoleculerError("Failed to check template", 500, "TEMPLATE_CHECK_ERROR");
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
                path: "/order-confirmation-template/:id/status"
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
                
                this.logger.info("Template submitted for approval:", approvalData);
                
                return approvalData;
                
            } catch (error) {
                this.logger.error("Error submitting template for approval:", error);
                throw error;
            }
        },
        
        /**
         * Generate template parameters for order data
         */
        generateTemplateParameters(orderData, customerData) {
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
            
            if (parameters.length < 4) {
                throw new Error("Order confirmation template requires at least 4 parameters");
            }
            
            return true;
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
                    
                    this.logger.info(`Template ${templateId} status updated to ${status}`);
                    
                } catch (error) {
                    this.logger.error("Error updating template approval status:", error);
                }
            }
        }
    },
    
    created() {
        this.logger.info("Order Confirmation Template service created");
    },
    
    started() {
        this.logger.info("Order Confirmation Template service started");
    },
    
    stopped() {
        this.logger.info("Order Confirmation Template service stopped");
    }
};
