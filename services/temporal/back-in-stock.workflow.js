"use strict";

const { proxyActivities } = require('@temporalio/workflow');

// Define activities
const { sendBackInStockNotifications } = proxyActivities({
    startToCloseTimeout: '2 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1s',
        maximumInterval: '10s',
    }
});

/**
 * Back-in-Stock Notification Workflow
 * 
 * This workflow handles the complete back-in-stock notification process:
 * 1. Receives product data and subscription information
 * 2. Processes the back-in-stock variants
 * 3. Sends WhatsApp notifications to all subscribed customers
 * 4. Handles retries and error scenarios
 */

/**
 * Main workflow execution
 * @param {Object} productData - Shopify product data
 * @param {Array} backInStockVariants - Variants that are back in stock
 * @param {Array} subscriptions - Customer subscriptions for this product
 * @param {Object} orgData - Organization data (org_id, branch_id, shopDomain)
 * @returns {Object} Workflow result
 */
async function BackInStockWorkflow(productData, backInStockVariants, subscriptions, orgData) {
    // Defensive input validation
    if (!productData || typeof productData !== "object" || !productData.id) {
        return {
            success: false,
            message: "Invalid productData: must be an object with an 'id' property",
            productId: productData && productData.id ? productData.id : null,
            error: "Invalid productData"
        };
    }
    
    if (!Array.isArray(backInStockVariants) || backInStockVariants.length === 0) {
        return {
            success: false,
            message: "Invalid backInStockVariants: must be a non-empty array",
            productId: productData.id,
            error: "Invalid backInStockVariants"
        };
    }
    
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        return {
            success: false,
            message: "No subscriptions found for this product",
            productId: productData.id,
            error: "No subscriptions"
        };
    }
    
    if (!orgData || typeof orgData !== "object" || !orgData.orgId) {
        return {
            success: false,
            message: "Invalid orgData: must be an object with an 'orgId' property",
            productId: productData.id,
            error: "Invalid orgData"
        };
    }

    try {
        console.log("🔄 BackInStockWorkflow started for product:", productData.id);
        console.log("📦 Back in stock variants:", backInStockVariants.length);
        console.log("👥 Subscriptions to notify:", subscriptions.length);
        console.log("🏢 Org data:", orgData);

        // Send back-in-stock notifications
        console.log("📤 Sending back-in-stock notifications...");
        let notificationResult;
        try {
            notificationResult = await sendBackInStockNotifications(
                productData, 
                backInStockVariants, 
                subscriptions, 
                orgData
            );
        } catch (activityError) {
            // Handle activity-specific errors
            console.error("❌ sendBackInStockNotifications activity failed:", activityError);
            return {
                success: false,
                message: "Failed to send back-in-stock notifications",
                productId: productData.id,
                error: activityError && activityError.message ? activityError.message : String(activityError)
            };
        }

        const result = {
            success: true,
            message: "Back-in-stock notification workflow completed successfully",
            productId: productData.id,
            productTitle: productData.title,
            variantsBackInStock: backInStockVariants.length,
            subscriptionsNotified: subscriptions.length,
            notificationResult: notificationResult,
            timestamp: new Date().toISOString()
        };

        console.log("🎉 BackInStockWorkflow completed:", result);
        return result;

    } catch (error) {
        // Catch-all for unexpected errors
        console.error("❌ BackInStockWorkflow failed:", error);

        return {
            success: false,
            message: "Back-in-stock notification failed",
            productId: productData && productData.id ? productData.id : null,
            error: error && error.message ? error.message : String(error)
        };
    }
}

module.exports = {
    BackInStockWorkflow
};
