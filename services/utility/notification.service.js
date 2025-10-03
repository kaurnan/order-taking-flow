const fs = require('fs');
const path = require('path');

module.exports = {
    name: "notification",

    settings: {
        configPath: path.join(__dirname, '../../config/notifications.json')
    },

    methods: {
        /**
         * Load notification templates from JSON file
         */
        loadTemplates() {
            try {
                const configData = fs.readFileSync(this.settings.configPath, 'utf8');
                return JSON.parse(configData);
            } catch (error) {
                this.logger.error('Failed to load notification templates:', error);
                return { templates: {}, bulk_actions: {}, status_icons: {} };
            }
        },

        /**
         * Replace variables in template strings
         * @param {string} template - Template string with {{variable}} placeholders
         * @param {Object} variables - Object containing variable values
         * @returns {string} - Processed template string
         */
        replaceVariables(template, variables) {
            if (!template || typeof template !== 'string') return template;

            return template.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
                const value = variables[variable];
                if (value === undefined || value === null) {
                    this.logger.warn(`Variable ${variable} not found in template, keeping placeholder: ${match}`);
                    return match;
                }
                return String(value);
            });
        },

        /**
         * Generate notification payload from template
         * @param {string} templateKey - Key of the template to use
         * @param {Object} variables - Variables to replace in template
         * @param {Object} additionalData - Additional data for the notification
         * @returns {Object} - Complete notification payload
         */
        generateNotificationPayload(templateKey, variables = {}, additionalData = {}) {
            const config = this.loadTemplates();
            const template = config.templates[templateKey];

            if (!template) {
                this.logger.error(`Template not found: ${templateKey}`);
                return null;
            }

            // Validate required fields
            const requiredFields = ['title', 'description', 'type'];
            const missingFields = requiredFields.filter(field => !template[field]);
            if (missingFields.length > 0) {
                this.logger.error(`Template ${templateKey} is missing required fields: ${missingFields.join(', ')}`);
                return null;
            }

            // Process template with variables
            const processedTemplate = {};
            Object.keys(template).forEach(key => {
                if (typeof template[key] === 'string') {
                    processedTemplate[key] = this.replaceVariables(template[key], variables);
                } else {
                    processedTemplate[key] = template[key];
                }
            });

            // Build final payload
            const payload = {
                title: processedTemplate.title,
                link: processedTemplate.link_template || processedTemplate.link,
                isexternal: false,
                icon: processedTemplate.icon,
                description: processedTemplate.description,
                description_img: "test.png",
                read: false,
                branch_id: additionalData.branch_id || null,
                organisation_id: additionalData.organisation_id,
                user_id: additionalData.user_id || "",
                created_at: new Date(),
                type: processedTemplate.type,
                broadcast_type: additionalData.broadcast_type || "branch"
            };

            // Validate final payload
            if (!payload.organisation_id) {
                this.logger.error(`Notification payload missing required organisation_id for template: ${templateKey}`);
                return null;
            }

            return payload;
        },

        /**
         * Get bulk action messages
         * @param {string} action - Action key
         * @returns {Object} - Action messages
         */
        getBulkActionMessages(action) {
            const config = this.loadTemplates();
            return config.bulk_actions[action] || {};
        },

        /**
         * Get status icon
         * @param {string} status - Status key
         * @returns {string} - Icon identifier
         */
        getStatusIcon(status) {
            const config = this.loadTemplates();
            return config.status_icons[status] || "info";
        },

        /**
         * Send notification to Supabase
         * @param {Object} ctx - Moleculer context
         * @param {string} templateKey - Template key
         * @param {Object} variables - Template variables
         * @param {Object} additionalData - Additional notification data
         */
        async sendNotification(ctx, templateKey, variables = {}, additionalData = {}) {
            try {
                const payload = this.generateNotificationPayload(templateKey, variables, additionalData);

                if (!payload) {
                    throw new Error(`Failed to generate notification payload for template: ${templateKey}`);
                }

                const result = await ctx.call("supabase.insertData", {
                    table: "notifications",
                    payload
                });

                this.logger.info(`Notification sent successfully for template: ${templateKey}`, result);
                return result;
            } catch (error) {
                this.logger.error(`Failed to send notification for template: ${templateKey}:`, error);
                throw error;
            }
        }
    },

    actions: {
        /**
         * Send notification using template
         */
        send: {
            async handler(ctx) {
                const { templateKey, variables, additionalData } = ctx.params;
                return await this.sendNotification(ctx, templateKey, variables, additionalData);
            }
        },

        /**
         * Get bulk action messages
         */
        getBulkActionMessages: {
            async handler(ctx) {
                const { action } = ctx.params;
                return this.getBulkActionMessages(action);
            }
        },

        /**
         * Get status icon
         */
        getStatusIcon: {
            async handler(ctx) {
                const { status } = ctx.params;
                return this.getStatusIcon(status);
            }
        },

        /**
         * Get all available templates
         */
        getTemplates: {
            async handler(ctx) {
                const config = this.loadTemplates();
                return config.templates;
            }
        },

        /**
         * Get all available bulk actions
         */
        getBulkActions: {
            async handler(ctx) {
                const config = this.loadTemplates();
                return config.bulk_actions;
            }
        },

        /**
         * Validate template variables
         */
        validateTemplate: {
            async handler(ctx) {
                const { templateKey, variables } = ctx.params;
                const config = this.loadTemplates();
                const template = config.templates[templateKey];

                if (!template) {
                    return { valid: false, error: `Template not found: ${templateKey}` };
                }

                // Check for missing variables
                const templateString = JSON.stringify(template);
                const variableMatches = templateString.match(/\{\{(\w+)\}\}/g) || [];
                const requiredVariables = [...new Set(variableMatches.map(match => match.slice(2, -2)))];
                const providedVariables = Object.keys(variables);
                const missingVariables = requiredVariables.filter(variable => !providedVariables.includes(variable));

                return {
                    valid: missingVariables.length === 0,
                    requiredVariables,
                    providedVariables,
                    missingVariables,
                    template
                };
            }
        }
    },

    events: {
        "notification.sendEvent": {
            async handler(ctx) {
                const { templateKey, variables, additionalData } = ctx.params;
                return await this.sendNotification(ctx, templateKey, variables, additionalData);
            }
        },
        "wallet.rechargeEmail": {
            async handler(ctx) {
                const { org_id, userId, amount, currency, balance, additional_email } = ctx.params;

                const subject = "Wallet Recharge Successful";
                const emailText = `Dear User,\n\nYour wallet has been recharged with ${currency} ${amount}. Your new balance is ${currency} ${balance}.\n\nRegards,\nFlowflex Team`;
                const emailHtml = `<p>Dear User,</p><p>Your wallet has been recharged with <strong>${currency} ${amount}</strong>. Your new balance is <strong>${currency} ${balance}</strong>.</p><p>Regards,<br/>Flowflex Team</p>`;

                // Send email notifications to additional_email addresses
                if (additional_email && additional_email.length > 0) {
                    for (const email of additional_email) {
                        try {
                            await ctx.call("email.send", {
                                to: email,
                                subject: subject,
                                text: emailText,
                                html: emailHtml
                            });
                            this.logger.info(`Wallet recharge email sent to ${email} for org ${org_id}`);
                        } catch (emailErr) {
                            this.logger.error(`Failed to send wallet recharge email to ${email}:`, emailErr);
                        }
                    }
                } else {
                    this.logger.info(`No additional emails configured for org ${org_id} to send wallet recharge alert.`);
                }
            }
        },
        "wallet.rechargeFailedEmail": {
            async handler(ctx) {
                const { org_id, userId, amount, currency, merchantOrderId, reason, additional_email } = ctx.params;

                const subject = "Wallet Recharge Failed";
                const emailText = `Dear User,\n\nYour wallet recharge of ${currency} ${amount} (Order ID: ${merchantOrderId}) has failed. Reason: ${reason}.\nPlease try again or contact support.\n\nRegards,\nFlowflex Team`;
                const emailHtml = `<p>Dear User,</p><p>Your wallet recharge of <strong>${currency} ${amount}</strong> (Order ID: ${merchantOrderId}) has failed. Reason: <strong>${reason}</strong>.</p><p>Please try again or contact support.</p><p>Regards,<br/>Flowflex Team</p>`;

                // Send email notifications to additional_email addresses
                if (additional_email && additional_email.length > 0) {
                    for (const email of additional_email) {
                        try {
                            await ctx.call("email.send", {
                                to: email,
                                subject: subject,
                                text: emailText,
                                html: emailHtml
                            });
                            this.logger.info(`Wallet recharge failed email sent to ${email} for org ${org_id}`);
                        } catch (emailErr) {
                            this.logger.error(`Failed to send wallet recharge failed email to ${email}:`, emailErr);
                        }
                    }
                } else {
                    this.logger.info(`No additional emails configured for org ${org_id} to send wallet recharge failed alert.`);
                }
            }
        }
    }
};
