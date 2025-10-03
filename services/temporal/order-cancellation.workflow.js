"use strict";

const { proxyActivities } = require('@temporalio/workflow');

// Define activities
const { sendWhatsAppMessage } = proxyActivities({
    startToCloseTimeout: '1 minute',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1s',
        maximumInterval: '10s',
    }
});

/**
 * Order Cancellation Workflow
 * 
 * This workflow handles the complete order cancellation process:
 * 1. Receives order cancellation data from Shopify
 * 2. Processes the cancellation information
 * 3. Creates a WhatsApp template message for cancellation
 * 4. Sends the cancellation notification via WhatsApp
 * 5. Handles retries and error scenarios
 */

/**
 * Main workflow execution
 * @param {Object} orderData - Shopify order data
 * @param {Object} customerData - Customer information
 * @param {Object} orgData - Organization data (org_id, branch_id)
 * @returns {Object} Workflow result
 */
async function OrderCancellationWorkflow(orderData, customerData, orgData) {
    // Defensive input validation
    if (!orderData || typeof orderData !== "object" || !orderData.id) {
        return {
            success: false,
            message: "Invalid orderData: must be an object with an 'id' property",
            orderId: orderData && orderData.id ? orderData.id : null,
            error: "Invalid orderData"
        };
    }
    if (!customerData || typeof customerData !== "object" || !customerData.phone) {
        return {
            success: false,
            message: "Invalid customerData: must be an object with a 'phone' property",
            orderId: orderData.id,
            error: "Invalid customerData"
        };
    }
    if (!orgData || typeof orgData !== "object" || !orgData.orgId) {
        return {
            success: false,
            message: "Invalid orgData: must be an object with an 'orgId' property",
            orderId: orderData.id,
            error: "Invalid orgData"
        };
    }

    try {
        console.log("🔄 Starting Order Cancellation Workflow for order:", orderData.id);
        console.log("📱 Customer phone:", customerData.phone);
        console.log("🏢 Org data:", orgData);

        // Send WhatsApp cancellation message
        console.log("📤 Sending WhatsApp cancellation notification...");
        let whatsappResult;
        try {
            whatsappResult = await sendWhatsAppMessage(orderData, customerData, orgData);
        } catch (activityError) {
            // Handle activity-specific errors
            console.error("❌ sendWhatsAppMessage activity failed:", activityError);
            return {
                success: false,
                message: "Failed to send WhatsApp cancellation notification",
                orderId: orderData.id,
                error: activityError && activityError.message ? activityError.message : String(activityError)
            };
        }

        const result = {
            success: true,
            message: "Order cancellation workflow completed successfully",
            orderId: orderData.id,
            customerPhone: customerData.phone,
            whatsappResult: whatsappResult,
            timestamp: new Date().toISOString()
        };

        console.log("🎉 OrderCancellationWorkflow completed:", result);
        return result;

    } catch (error) {
        // Catch-all for unexpected errors
        console.error("❌ OrderCancellationWorkflow failed:", error);

        return {
            success: false,
            message: "Order cancellation failed",
            orderId: orderData && orderData.id ? orderData.id : null,
            error: error && error.message ? error.message : String(error)
        };
    }
}

module.exports = {
    OrderCancellationWorkflow
};
