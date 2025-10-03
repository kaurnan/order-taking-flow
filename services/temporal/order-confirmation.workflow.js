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
 * Order Confirmation Workflow
 * 
 * This workflow handles the complete order confirmation process:
 * 1. Receives order data from Shopify
 * 2. Processes the order information
 * 3. Creates a WhatsApp template message
 * 4. Sends the confirmation via WhatsApp
 * 5. Handles retries and error scenarios
 */

/**
 * Main workflow execution
 * @param {Object} orderData - Shopify order data
 * @param {Object} customerData - Customer information
 * @param {Object} orgData - Organization data (org_id, branch_id)
 * @returns {Object} Workflow result
 */
async function OrderConfirmationWorkflow(orderData, customerData, orgData) {
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
        console.log("🔄 OrderConfirmationWorkflow started for order:", orderData.id);
        console.log("📱 Customer phone:", customerData.phone);
        console.log("🏢 Org data:", orgData);

        // Send WhatsApp message
        console.log("📤 Sending WhatsApp confirmation message...");
        let whatsappResult;
        try {
            whatsappResult = await sendWhatsAppMessage(orderData, customerData, orgData);
        } catch (activityError) {
            // Handle activity-specific errors
            console.error("❌ sendWhatsAppMessage activity failed:", activityError);
            return {
                success: false,
                message: "Failed to send WhatsApp confirmation message",
                orderId: orderData.id,
                error: activityError && activityError.message ? activityError.message : String(activityError)
            };
        }

        const result = {
            success: true,
            message: "Order confirmation workflow completed successfully",
            orderId: orderData.id,
            customerPhone: customerData.phone,
            whatsappResult: whatsappResult,
            timestamp: new Date().toISOString()
        };

        console.log("🎉 OrderConfirmationWorkflow completed:", result);
        
        // Add a longer delay to make the workflow more visible in Temporal UI
        console.log("⏳ Adding 15-second delay to make workflow visible in UI...");
        await new Promise(resolve => setTimeout(resolve, 15000)); // 15 second delay
        console.log("✅ Delay completed, workflow finishing...");
        
        return result;

    } catch (error) {
        // Catch-all for unexpected errors
        console.error("❌ OrderConfirmationWorkflow failed:", error);

        return {
            success: false,
            message: "Order confirmation failed",
            orderId: orderData && orderData.id ? orderData.id : null,
            error: error && error.message ? error.message : String(error)
        };
    }
}

module.exports = {
    OrderConfirmationWorkflow
};