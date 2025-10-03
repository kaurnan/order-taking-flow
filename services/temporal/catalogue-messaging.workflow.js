"use strict";

const { proxyActivities } = require('@temporalio/workflow');

// Define activities
const { sendCatalogueMessage, sendCatalogueTemplate } = proxyActivities({
    startToCloseTimeout: '2 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1s',
        maximumInterval: '10s',
    }
});

/**
 * Catalogue Messaging Workflow
 * 
 * This workflow handles sending catalogue messages to customers:
 * 1. Receives customer data and catalogue information
 * 2. Sends interactive catalogue message or template
 * 3. Handles retries and error scenarios
 */

/**
 * Main workflow execution
 * @param {Object} customerData - Customer information
 * @param {Object} catalogueData - Catalogue information
 * @param {Object} orgData - Organization data (org_id, branch_id)
 * @param {Object} messageConfig - Message configuration
 * @returns {Object} Workflow result
 */
async function CatalogueMessagingWorkflow(customerData, catalogueData, orgData, messageConfig) {
    // Defensive input validation
    if (!customerData || typeof customerData !== "object" || !customerData.phone) {
        return {
            success: false,
            message: "Invalid customerData: must be an object with a 'phone' property",
            error: "Invalid customerData"
        };
    }
    
    if (!catalogueData || typeof catalogueData !== "object" || !catalogueData.catalogueId) {
        return {
            success: false,
            message: "Invalid catalogueData: must be an object with a 'catalogueId' property",
            error: "Invalid catalogueData"
        };
    }
    
    if (!orgData || typeof orgData !== "object" || !orgData.orgId) {
        return {
            success: false,
            message: "Invalid orgData: must be an object with an 'orgId' property",
            error: "Invalid orgData"
        };
    }

    try {
        console.log(`Starting catalogue messaging workflow for customer: ${customerData.phone}`);
        console.log(`Catalogue ID: ${catalogueData.catalogueId}`);
        console.log(`Message type: ${messageConfig.type || 'interactive'}`);

        let result;

        if (messageConfig.type === 'template') {
            // Send catalogue template message
            result = await sendCatalogueTemplate({
                to: customerData.phone,
                templateName: messageConfig.templateName,
                templateLanguage: messageConfig.templateLanguage || 'en',
                catalogueId: catalogueData.catalogueId,
                templateData: messageConfig.templateData || {},
                channel_id: messageConfig.channel_id,
                channel: messageConfig.channel,
                orgId: orgData.orgId,
                branchId: orgData.branchId
            });
        } else {
            // Send interactive catalogue message
            result = await sendCatalogueMessage({
                to: customerData.phone,
                catalogueData: catalogueData,
                message: messageConfig.message || "Check out our latest products!",
                channel_id: messageConfig.channel_id,
                channel: messageConfig.channel,
                orgId: orgData.orgId,
                branchId: orgData.branchId
            });
        }

        console.log(`Catalogue message sent successfully: ${result.messageId}`);

        return {
            success: true,
            message: "Catalogue message sent successfully",
            messageId: result.messageId,
            phone: customerData.phone,
            catalogueId: catalogueData.catalogueId,
            type: messageConfig.type || 'interactive'
        };

    } catch (error) {
        console.error(`Catalogue messaging workflow failed:`, error);
        
        return {
            success: false,
            message: `Failed to send catalogue message: ${error.message}`,
            error: error.message,
            phone: customerData.phone,
            catalogueId: catalogueData.catalogueId
        };
    }
}

module.exports = {
    CatalogueMessagingWorkflow
};
