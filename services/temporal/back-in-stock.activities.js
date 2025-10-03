"use strict";

/**
 * Back-in-Stock Activities
 * 
 * These activities handle the actual business logic for the back-in-stock notification workflow
 */

/**
 * Send back-in-stock notifications to all subscribed customers
 * @param {Object} productData - Product data from Shopify
 * @param {Array} backInStockVariants - Variants that are back in stock
 * @param {Array} subscriptions - Customer subscriptions
 * @param {Object} orgData - Organization data
 * @returns {Object} Notification result
 */
async function sendBackInStockNotifications(productData, backInStockVariants, subscriptions, orgData) {
    console.log("📱 Sending back-in-stock notifications via HTTP call...");
    console.log("Product ID:", productData.id);
    console.log("Product Title:", productData.title);
    console.log("Variants back in stock:", backInStockVariants.length);
    console.log("Subscriptions to notify:", subscriptions.length);
    console.log("Org ID:", orgData.orgId);

    // Basic input validation
    if (!productData || typeof productData !== "object" || !productData.id) {
        const errMsg = "Invalid productData: must be an object with an 'id' property";
        console.error(errMsg, productData);
        throw new Error(errMsg);
    }
    
    if (!Array.isArray(backInStockVariants) || backInStockVariants.length === 0) {
        const errMsg = "Invalid backInStockVariants: must be a non-empty array";
        console.error(errMsg, backInStockVariants);
        throw new Error(errMsg);
    }
    
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        const errMsg = "Invalid subscriptions: must be a non-empty array";
        console.error(errMsg, subscriptions);
        throw new Error(errMsg);
    }
    
    if (!orgData || typeof orgData !== "object" || !orgData.orgId) {
        const errMsg = "Invalid orgData: must be an object with an 'orgId' property";
        console.error(errMsg, orgData);
        throw new Error(errMsg);
    }

    try {
        const http = require('http');
        const orderProcessorUrl = 'http://localhost:3001';

        // Prepare notification data
        const notificationData = {
            productData: productData,
            backInStockVariants: backInStockVariants,
            subscriptions: subscriptions,
            orgData: orgData
        };

        const postData = JSON.stringify(notificationData);

        const responseData = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: 3001,
                path: '/api/order-processor/send-back-in-stock-notifications',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 30000 // 30 seconds timeout for multiple notifications
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    // Check for HTTP error status codes
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        const errMsg = `HTTP error: ${res.statusCode} ${res.statusMessage}`;
                        console.error(errMsg, data);
                        return reject(new Error(errMsg));
                    }
                    try {
                        const jsonData = JSON.parse(data);
                        // Check for error in response body
                        if (jsonData && jsonData.error) {
                            const errMsg = `Order processor error: ${jsonData.error}`;
                            console.error(errMsg, jsonData);
                            return reject(new Error(errMsg));
                        }
                        resolve(jsonData);
                    } catch (error) {
                        console.error("Failed to parse response JSON:", error, data);
                        reject(new Error("Failed to parse response JSON: " + error.message));
                    }
                });
            });

            req.on('error', (error) => {
                console.error("HTTP request error:", error);
                reject(new Error("HTTP request error: " + error.message));
            });

            req.on('timeout', () => {
                console.error("HTTP request timed out");
                req.destroy();
                reject(new Error("HTTP request timed out"));
            });

            req.write(postData);
            req.end();
        });

        console.log("✅ Back-in-stock notifications sent successfully:", responseData);
        return responseData;

    } catch (error) {
        console.error("❌ Failed to send back-in-stock notifications:", error);
        // Optionally, wrap the error with more context
        throw new Error(`Failed to send back-in-stock notifications: ${error.message}`);
    }
}

/**
 * Update subscription status after notification sent
 * @param {Array} subscriptions - Subscriptions that were notified
 * @returns {Object} Update result
 */
async function updateSubscriptionStatus(subscriptions) {
    console.log("📝 Updating subscription status for notified customers...");
    
    try {
        const http = require('http');
        const orderProcessorUrl = 'http://localhost:3001';

        const postData = JSON.stringify({ subscriptions });

        const responseData = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: 3001,
                path: '/api/order-processor/update-subscription-status',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 10000 // 10 seconds timeout
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        const errMsg = `HTTP error: ${res.statusCode} ${res.statusMessage}`;
                        console.error(errMsg, data);
                        return reject(new Error(errMsg));
                    }
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (error) {
                        console.error("Failed to parse response JSON:", error, data);
                        reject(new Error("Failed to parse response JSON: " + error.message));
                    }
                });
            });

            req.on('error', (error) => {
                console.error("HTTP request error:", error);
                reject(new Error("HTTP request error: " + error.message));
            });

            req.on('timeout', () => {
                console.error("HTTP request timed out");
                req.destroy();
                reject(new Error("HTTP request timed out"));
            });

            req.write(postData);
            req.end();
        });

        console.log("✅ Subscription status updated successfully:", responseData);
        return responseData;

    } catch (error) {
        console.error("❌ Failed to update subscription status:", error);
        throw new Error(`Failed to update subscription status: ${error.message}`);
    }
}

// Export the activities
module.exports = {
    BackInStockActivities: {
        sendBackInStockNotifications,
        updateSubscriptionStatus
    }
};
