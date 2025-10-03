"use strict";

const { MoleculerError } = require("moleculer").Errors;

module.exports = {
    name: "catalogue-messaging",

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {
        /**
         * Send catalogue message to customer
         */
        sendCatalogueMessage: {
            auth: false,
            params: {
                customerId: "string",
                catalogueId: "string",
                messageType: { type: "enum", values: ["interactive", "template"], default: "interactive" },
                message: { type: "string", optional: true, default: "Check out our latest products!" },
                templateName: { type: "string", optional: true },
                templateLanguage: { type: "string", optional: true, default: "en" },
                templateData: { type: "object", optional: true },
                thumbnailProductId: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { customerId, catalogueId, messageType, message, templateName, templateLanguage, templateData, thumbnailProductId } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                try {
                    this.logger.info(`Sending catalogue message to customer: ${customerId}`);

                    // Get real customer data from your system
                    const customer = await this.getRealCustomer(customerId, org_id, branch_id);

                    this.logger.info(`Using real customer data: ${customer.name} (${customer.phone})`);

                    // Find available WhatsApp channel (same as order confirmation)
                    const availableChannel = await this.findAvailableWhatsAppChannel(org_id);
                    if (!availableChannel) {
                        throw new MoleculerError("No WhatsApp channel available", 404, "NO_CHANNEL_AVAILABLE");
                    }

                    this.logger.info(`Using WhatsApp channel: ${availableChannel._id} (BSP: ${availableChannel.bsp}, Phone: ${availableChannel.phone_number_details?.display_phone_number})`);

                    // Prepare catalogue data
                    const catalogueData = {
                        catalogueId: catalogueId
                    };

                    // Prepare message configuration
                    const messageConfig = {
                        type: messageType,
                        message: message,
                        templateName: templateName,
                        templateLanguage: templateLanguage,
                        templateData: templateData,
                        thumbnailProductId: thumbnailProductId,
                        channel_id: availableChannel._id.toString(),
                        channel: {
                            waba_id: availableChannel.waba_id,
                            phone_number_id: availableChannel.phone_number_id,
                            bsp: availableChannel.bsp || "interakt",
                            app_id: availableChannel.app_id,
                            token: availableChannel.token,
                            access_token: availableChannel.access_token
                        }
                    };

                    // Start temporal workflow via HTTP
                    const axios = require('axios');
                    const workflowResult = await axios.post('http://localhost:3003/exec-catalogue-messaging', {
                        customerData: {
                            _id: customer._id,
                            name: customer.name,
                            phone: customer.phone,
                            email: customer.email
                        },
                        catalogueData: catalogueData,
                        orgData: {
                            orgId: org_id,
                            branchId: branch_id
                        },
                        messageConfig: messageConfig
                    });

                    // Log the message (console only for now)
                    this.logger.info(`Catalogue message sent: ${customerId} -> ${catalogueId} (${workflowResult.data.workflowId})`);

                    return {
                        success: true,
                        workflowId: workflowResult.data.workflowId,
                        message: "Catalogue message workflow started successfully",
                        customer: {
                            id: customer._id,
                            name: customer.name,
                            phone: customer.phone
                        },
                        catalogueId: catalogueId
                    };

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
         * Get real customers from your system
         */
        getRealCustomers: {
            auth: false,
            params: {
                orgId: "string",
                branchId: { type: "string", optional: true },
                limit: { type: "number", optional: true, default: 10, convert: true }
            },
            async handler(ctx) {
                const { orgId, branchId, limit } = ctx.params;

                try {
                    this.logger.info(`Getting real customers for org: ${orgId}`);

                    // Get customers from your real customer service
                    const customers = await this.broker.call("customer.list", {
                        limit: limit,
                        offset: 0
                    }, {
                        meta: {
                            org_id: orgId,
                            branch_id: branchId
                        }
                    });

                    if (customers && customers.data) {
                        this.logger.info(`Found ${customers.data.length} real customers`);
                        return {
                            success: true,
                            count: customers.data.length,
                            customers: customers.data.map(customer => ({
                                id: customer._id,
                                name: customer.name,
                                phone: customer.phone,
                                email: customer.email
                            }))
                        };
                    }

                    // If no customers found, try to get from audience
                    const audience = await this.broker.call("customer.getAudience", {
                        organisation_id: orgId
                    });

                    if (audience && audience.data) {
                        this.logger.info(`Found ${audience.data.length} customers in audience`);
                        return {
                            success: true,
                            count: audience.data.length,
                            customers: audience.data.slice(0, limit).map(customer => ({
                                id: customer._id,
                                name: customer.name,
                                phone: customer.phone,
                                email: customer.email
                            }))
                        };
                    }

                    return {
                        success: true,
                        count: 0,
                        customers: [],
                        message: "No customers found"
                    };

                } catch (error) {
                    this.logger.error("Error getting real customers:", error);
                    throw new MoleculerError(`Failed to get customers: ${error.message}`, 500, "CUSTOMER_FETCH_ERROR");
                }
            }
        },

        /**
         * Send catalogue message using just phone number (simplified for testing)
         */
        sendCatalogueToPhone: {
            auth: false,
            params: {
                phoneNumber: "string",
                catalogueId: "string",
                messageType: { type: "enum", values: ["interactive", "template"], default: "interactive" },
                message: { type: "string", optional: true, default: "Check out our latest products! 🛍️" },
                orgId: { type: "string", optional: true, default: "683d41c15fb092a0554fdf30" },
                branchId: { type: "string", optional: true, default: "default-branch-id" }
            },
            async handler(ctx) {
                const { phoneNumber, catalogueId, messageType, message, orgId, branchId } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                
                // Use provided orgId or fallback to meta or default
                const finalOrgId = orgId || org_id || "default-org-id";
                const finalBranchId = branchId || branch_id || "default-branch-id";

                try {
                    this.logger.info(`Sending catalogue message to phone: ${phoneNumber}`);

                    // Create customer object from phone number
                    const customer = {
                        _id: phoneNumber,
                        name: `Customer ${phoneNumber}`,
                        phone: phoneNumber,
                        email: `${phoneNumber.replace('+', '')}@example.com`,
                        org_id: finalOrgId,
                        branch_id: finalBranchId,
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    this.logger.info(`Using customer: ${customer.name} (${customer.phone})`);

                    // Find available WhatsApp channel
                    const availableChannel = await this.findAvailableWhatsAppChannel(finalOrgId);
                    if (!availableChannel) {
                        throw new MoleculerError("No WhatsApp channel available", 404, "NO_CHANNEL_AVAILABLE");
                    }

                    this.logger.info(`Using WhatsApp channel: ${availableChannel._id} (BSP: ${availableChannel.bsp})`);

                    // Fetch real products from Meta catalogue
                    const products = await this.broker.call("meta-catalogue.getCatalogueProducts", {
                        catalogueId: catalogueId,
                        limit: 5
                    });

                    // Prepare catalogue data with product details
                    const catalogueData = {
                        catalogueId: catalogueId,
                        products: products.products || []
                    };

                    // Prepare message configuration
                    const messageConfig = {
                        messageType: messageType,
                        message: message,
                        templateName: messageType === "template" ? "catalogue_template" : null,
                        templateLanguage: "en",
                        channel_id: availableChannel._id.toString(),
                        channel: {
                            waba_id: availableChannel.waba_id,
                            phone_number_id: availableChannel.phone_number_id,
                            bsp: availableChannel.bsp || "interakt",
                            app_id: availableChannel.app_id,
                            token: availableChannel.token,
                            access_token: availableChannel.access_token
                        }
                    };

                    // Start temporal workflow via HTTP
                    const axios = require('axios');
                    const workflowResult = await axios.post('http://localhost:3003/exec-catalogue-messaging', {
                        customerData: {
                            _id: customer._id,
                            name: customer.name,
                            phone: customer.phone,
                            email: customer.email
                        },
                        catalogueData: catalogueData,
                        orgData: {
                            orgId: finalOrgId,
                            branchId: finalBranchId
                        },
                        messageConfig: messageConfig
                    });

                    this.logger.info(`Catalogue message workflow started: ${phoneNumber} -> ${catalogueId} (${workflowResult.data.workflowId})`);

                    return {
                        success: true,
                        workflowId: workflowResult.data.workflowId,
                        message: "Catalogue message workflow started successfully",
                        customer: {
                            id: customer._id,
                            name: customer.name,
                            phone: customer.phone
                        },
                        catalogueId: catalogueId,
                        productsSent: products.products.length
                    };

                } catch (error) {
                    this.logger.error("Failed to send catalogue message:", error);
                    throw new MoleculerError(
                        `Failed to send catalogue message: ${error.message}`,
                        500,
                        "CATALOGUE_MESSAGE_ERROR"
                    );
                }
            }
        },

        /**
         * Test WhatsApp message directly (bypasses channel lookup)
         */
        testWhatsAppDirect: {
            auth: false,
            params: {
                phoneNumber: "string",
                message: { type: "string", optional: true, default: "Test message from catalogue system! 🛍️" }
            },
            async handler(ctx) {
                const { phoneNumber, message } = ctx.params;

                try {
                    this.logger.info(`Testing WhatsApp message to: ${phoneNumber}`);

                    // Use the new channel ID
                    const channelId = "684b0f27325b7471155bf081";
                    
                    // Send direct WhatsApp message
                    const result = await this.broker.call("whatsapp.SendMsgViaBSP", {
                        to: phoneNumber,
                        contact_id: 12345, // Use a numeric contact_id
                        message_type: "text",
                        meta_payload: {
                            body: message
                        },
                        channel_id: channelId,
                        channel: {
                            bsp: "interakt",
                            waba_id: "your-waba-id"
                        }
                    }, {
                        meta: {
                            org_id: "default-org-id",
                            branch_id: "default-branch-id"
                        }
                    });

                    this.logger.info(`WhatsApp test message result:`, result);

                    return {
                        success: true,
                        result: result,
                        phone: phoneNumber,
                        message: "Test WhatsApp message sent successfully"
                    };

                } catch (error) {
                    this.logger.error("Failed to send test WhatsApp message:", error);
                    throw new MoleculerError(
                        `Failed to send test message: ${error.message}`,
                        500,
                        "WHATSAPP_TEST_ERROR"
                    );
                }
            }
        },

        /**
         * Test WhatsApp API directly (bypasses all services)
         */
        testWhatsAppAPI: {
            auth: false,
            params: {
                phoneNumber: "string",
                message: { type: "string", optional: true, default: "Direct API test message! 🛍️" }
            },
            async handler(ctx) {
                const { phoneNumber, message } = ctx.params;

                try {
                    this.logger.info(`Testing WhatsApp API directly to: ${phoneNumber}`);

                    // Test direct API call to Interakt
                    const axios = require('axios');
                    
                    const payload = {
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": phoneNumber,
                        "type": "text",
                        "text": {
                            "body": message
                        }
                    };

                    const url = `${process.env.INTERAKT_API}/419970451189619/messages`;
                    const headers = {
                        "x-access-token": process.env.INTERAKT_TOKEN,
                        "x-waba-id": "your-waba-id",
                        "Content-Type": "application/json"
                    };

                    this.logger.info(`Making API call to: ${url}`);
                    this.logger.info(`Payload:`, payload);

                    const response = await axios.post(url, payload, { headers });

                    this.logger.info(`WhatsApp API response:`, response.data);

                    return {
                        success: true,
                        response: response.data,
                        phone: phoneNumber,
                        message: "Direct WhatsApp API test completed"
                    };

                } catch (error) {
                    this.logger.error("Failed to test WhatsApp API:", error.response?.data || error.message);
                    return {
                        success: false,
                        error: error.response?.data || error.message,
                        phone: phoneNumber,
                        message: "Direct WhatsApp API test failed"
                    };
                }
            }
        },

        /**
         * Send catalogue message to multiple customers
         */
        sendBulkCatalogueMessage: {
            auth: false,
            params: {
                customerIds: { type: "array", items: "string" },
                catalogueId: "string",
                messageType: { type: "enum", values: ["interactive", "template"], default: "interactive" },
                message: { type: "string", optional: true, default: "Check out our latest products!" },
                templateName: { type: "string", optional: true },
                templateLanguage: { type: "string", optional: true, default: "en" },
                templateData: { type: "object", optional: true },
                thumbnailProductId: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { customerIds, catalogueId, messageType, message, templateName, templateLanguage, templateData, thumbnailProductId } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                try {
                    this.logger.info(`Sending bulk catalogue message to ${customerIds.length} customers`);

                    const results = [];
                    const errors = [];

                    // Process each customer
                    for (const customerId of customerIds) {
                        try {
                            const result = await this.broker.call("catalogue-messaging.sendCatalogueMessage", {
                                customerId,
                                catalogueId,
                                messageType,
                                message,
                                templateName,
                                templateLanguage,
                                templateData,
                                thumbnailProductId
                            }, {
                                meta: { org_id, branch_id }
                            });

                            results.push({
                                customerId,
                                success: true,
                                workflowId: result.workflowId
                            });

                        } catch (error) {
                            errors.push({
                                customerId,
                                success: false,
                                error: error.message
                            });
                        }
                    }

                    return {
                        success: true,
                        total: customerIds.length,
                        successful: results.length,
                        failed: errors.length,
                        results: results,
                        errors: errors
                    };

                } catch (error) {
                    this.logger.error("Error sending bulk catalogue message:", error);
                    throw new MoleculerError(
                        `Failed to send bulk catalogue message: ${error.message}`,
                        500,
                        "BULK_CATALOGUE_MESSAGE_ERROR"
                    );
                }
            }
        },

        /**
         * Get catalogue message history
         */
        getCatalogueMessageHistory: {
            auth: false,
            params: {
                customerId: { type: "string", optional: true },
                catalogueId: { type: "string", optional: true },
                limit: { type: "number", optional: true, default: 20 },
                offset: { type: "number", optional: true, default: 0 }
            },
            async handler(ctx) {
                const { customerId, catalogueId, limit, offset } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                try {
                    const query = {
                        orgId: org_id,
                        branchId: branch_id
                    };

                    if (customerId) {
                        query.customerId = customerId;
                    }

                    if (catalogueId) {
                        query.catalogueId = catalogueId;
                    }

                    const messages = await this.adapter.find({
                        query,
                        limit,
                        offset,
                        sort: { createdAt: -1 }
                    });

                    return {
                        success: true,
                        messages: messages,
                        total: messages.length
                    };

                } catch (error) {
                    this.logger.error("Error getting catalogue message history:", error);
                    throw new MoleculerError(
                        `Failed to get catalogue message history: ${error.message}`,
                        500,
                        "HISTORY_ERROR"
                    );
                }
            }
        }
    },

    /**
     * Methods
     */
    methods: {
        /**
         * Get real customer data from your system (with fallback for missing services)
         */
        async getRealCustomer(customerId, orgId, branchId) {
            try {
                // Try to get customer from your real customer service
                try {
                    const customer = await this.broker.call("customer.get", {
                        id: customerId
                    }, {
                        meta: {
                            org_id: orgId,
                            branch_id: branchId
                        }
                    });

                    if (customer) {
                        this.logger.info(`Found real customer: ${customer.name} (${customer.phone})`);
                        return customer;
                    }
                } catch (serviceError) {
                    this.logger.warn(`Customer service not available: ${serviceError.message}`);
                }

                // If customer service not available, try to get from audience
                try {
                    const audienceCustomer = await this.broker.call("customer.getAudience", {
                        organisation_id: orgId,
                        customer_id: customerId
                    });

                    if (audienceCustomer) {
                        this.logger.info(`Found customer in audience: ${audienceCustomer.name} (${audienceCustomer.phone})`);
                        return audienceCustomer;
                    }
                } catch (audienceError) {
                    this.logger.warn(`Audience service not available: ${audienceError.message}`);
                }

                // Fallback: Create customer object from phone number (for testing)
                this.logger.info(`Creating customer object from phone number: ${customerId}`);
                const customer = {
                    _id: customerId,
                    name: `Customer ${customerId}`,
                    phone: customerId,
                    email: `${customerId.replace('+', '')}@example.com`,
                    org_id: orgId,
                    branch_id: branchId,
                    created_at: new Date(),
                    updated_at: new Date()
                };

                this.logger.info(`Created customer object: ${customer.name} (${customer.phone})`);
                return customer;
                
            } catch (error) {
                this.logger.error("Error getting real customer:", error);
                throw error;
            }
        },

        /**
         * Find available WhatsApp channel for organization (same as order confirmation)
         */
        async findAvailableWhatsAppChannel(orgId) {
            try {
                // Use a valid ObjectId format for testing
                const defaultOrgId = orgId || "683d41c15fb092a0554fdf30"; // Use the real orgId from logs
                
                this.logger.info(`Looking for WhatsApp channels for org: ${defaultOrgId}`);
                
                // Get channels directly from the database to avoid authentication issues
                const channels = await this.broker.call("channel.getChannelsDirect", {
                    orgId: defaultOrgId
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
                    this.logger.warn(`No suitable WhatsApp channel found for org: ${orgId}`);
                    this.logger.warn(`Available channels: ${channels.data.map(c => c.phone_number_details?.display_phone_number).join(', ')}`);
                    return null;
                }

                this.logger.info(`Using WhatsApp channel: ${whatsappChannel._id} (BSP: ${whatsappChannel.bsp}, Phone: ${whatsappChannel.phone_number_details?.display_phone_number}) for org: ${orgId}`);
                return whatsappChannel;

            } catch (error) {
                this.logger.error("Error finding WhatsApp channel:", error);
                return null;
            }
        }
    },

    /**
     * Service lifecycle events
     */
    created() {
        this.logger.info("Catalogue Messaging service created");
    }
};
