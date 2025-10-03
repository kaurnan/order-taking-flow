"use strict";

/**
 * Order Confirmation Activities
 * 
 * These activities handle the actual business logic for the order confirmation workflow
 */

/**
 * Validate order data
 * @param {Object} orderData - Order data to validate
 * @returns {Object} Validated order data
 */
async function validateOrderData(orderData) {
    console.log("Validating order data:", orderData.id);
    
    if (!orderData || !orderData.id) {
        throw new Error("Invalid order data: missing order ID");
    }
    
    return orderData;
}

/**
 * Process order information
 * @param {Object} orderData - Order data to process
 * @returns {Object} Processed order data
 */
async function processOrderInformation(orderData) {
    console.log("Processing order information for order:", orderData.id);
    
    // Add any additional processing logic here
    return {
        ...orderData,
        processed_at: new Date().toISOString()
    };
}

/**
 * Create WhatsApp template data
 * @param {Object} orderData - Processed order data
 * @param {Object} customerData - Customer data
 * @param {Object} orgData - Organization data
 * @returns {Object} Template data
 */
async function createWhatsAppTemplate(orderData, customerData, orgData) {
    try {
        if (!orderData || typeof orderData !== "object") {
            throw new Error("Invalid orderData: orderData is required and must be an object");
        }
        if (!customerData || typeof customerData !== "object") {
            throw new Error("Invalid customerData: customerData is required and must be an object");
        }
        if (!orgData || typeof orgData !== "object") {
            throw new Error("Invalid orgData: orgData is required and must be an object");
        }

        if (!orderData.id) {
            throw new Error("Invalid orderData: missing order ID");
        }

        if (!customerData._id) {
            throw new Error("Invalid customerData: missing customer _id");
        }

        // Defensive: orderNumber/totalPrice fallback
        const orderNumber = orderData.orderNumber || orderData.order_number || orderData.id;
        const totalAmount = orderData.totalPrice || orderData.total_price || "0";

        // Defensive: items fallback
        let itemsString = "Items";
        if (Array.isArray(orderData.items) && orderData.items.length > 0) {
            itemsString = orderData.items.map(item => item.title || item.name || "Item").join(", ");
        }

        const templateData = {
            customer_name: customerData.name || "Customer",
            order_number: orderNumber,
            total_amount: totalAmount,
            items: itemsString
        };

        return {
            templateData,
            contactId: customerData._id,
            orgData
        };
    } catch (error) {
        console.error("Error creating WhatsApp template:", error);
        // You may want to throw or return a specific error object
        throw new Error(`Failed to create WhatsApp template: ${error.message}`);
    }
}

/**
 * Send WhatsApp message via HTTP call to order-processor service
 * @param {Object} orderData - Order information
 * @param {Object} customerData - Customer information
 * @param {Object} orgData - Organization data
 * @returns {Object} Message result
 */
async function sendWhatsAppMessage(orderData, customerData, orgData) {
    console.log("📱 Sending WhatsApp message via HTTP call...");
    console.log("Order ID:", orderData.id);
    console.log("Customer phone:", customerData.phone);
    console.log("Org ID:", orgData.orgId);

    // Basic input validation
    if (!orderData || typeof orderData !== "object" || !orderData.id) {
        const errMsg = "Invalid orderData: must be an object with an 'id' property";
        console.error(errMsg, orderData);
        throw new Error(errMsg);
    }
    if (!customerData || typeof customerData !== "object" || !customerData.phone) {
        const errMsg = "Invalid customerData: must be an object with a 'phone' property";
        console.error(errMsg, customerData);
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

        const postData = JSON.stringify({
            orderData: orderData,
            customerData: customerData,
            orgData: orgData
        });

        const responseData = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: 3001,
                path: '/api/order-processor/sendWhatsAppMessage',
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

        console.log("✅ WhatsApp message sent successfully:", responseData);
        return responseData;

    } catch (error) {
        console.error("❌ Failed to send WhatsApp message:", error);
        // Optionally, wrap the error with more context
        throw new Error(`Failed to send WhatsApp message: ${error.message}`);
    }
}

// Export the activities
module.exports = {
    OrderConfirmationActivities: {
        validateOrderData,
        processOrderInformation,
        createWhatsAppTemplate,
        sendWhatsAppMessage
    }
};