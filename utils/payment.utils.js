/**
 * Payment Gateway Utilities
 * Common functions for payment gateway operations
 */

const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * Generate a unique merchant order ID
 * @param {string} orgId - Organization ID
 * @param {string} prefix - Prefix for the order ID
 * @returns {string} Unique merchant order ID
 */
function generateMerchantOrderId(orgId, prefix = "WALLET") {
    const random = Math.random().toString(36).substr(2, 6);
    return `${prefix}_${orgId}_${random}`;
}

/**
 * Validate payment amount
 * @param {number} amount - Amount to validate
 * @param {number} minAmount - Minimum allowed amount
 * @param {number} maxAmount - Maximum allowed amount
 * @returns {Object} Validation result
 */
function validateAmount(amount, minAmount = 1, maxAmount = 100000) {
    if (amount < minAmount) {
        return {
            valid: false,
            error: `Minimum amount is ${minAmount}`
        };
    }

    if (amount > maxAmount) {
        return {
            valid: false,
            error: `Maximum amount is ${maxAmount}`
        };
    }

    return { valid: true };
}

/**
 * Convert amount to paise (smallest currency unit)
 * @param {number} amount - Amount in rupees
 * @returns {number} Amount in paise
 */
function convertToPaise(amount) {
    return Math.round(amount * 100);
}

/**
 * Convert paise to rupees
 * @param {number} paise - Amount in paise
 * @returns {number} Amount in rupees
 */
function convertFromPaise(paise) {
    return paise / 100;
}

/**
 * Create transaction metadata
 * @param {Object} ctx - Moleculer context
 * @param {string} type - Transaction type
 * @returns {Object} Metadata object
 */
function createTransactionMetadata(ctx, type = "wallet_recharge") {
    return {
        initiated_at: new Date(),
        user_agent: ctx.meta.headers?.["user-agent"],
        ip_address: ctx.meta.headers?.["x-forwarded-for"] || ctx.meta.headers?.["x-real-ip"],
        type: type
    };
}

/**
 * Verify webhook signature for Razorpay
 * @param {string} rawBody - Raw request body string
 * @param {string} signature - Webhook signature
 * @param {string} secret - Webhook secret
 * @returns {boolean} Signature validity
 */
function verifyRazorpaySignature(rawBody, signature, secret) {
    try {
        console.log("=== Razorpay Signature Verification ===");
        console.log("Raw body for signature verification:", rawBody);
        console.log("Raw body type:", typeof rawBody);
        console.log("Secret key length:", secret ? secret.length : 0);
        console.log("Received signature:", signature);

        if (!secret) {
            console.error("ERROR: No secret key provided");
            return false;
        }

        const expectedSignature = crypto
            .createHmac("sha256", secret)
            .update(JSON.stringify(rawBody))
            .digest("hex");

        console.log("Expected signature:", expectedSignature);
        console.log("Signatures match:", expectedSignature === signature);
        console.log("=== End Signature Verification ===");

        return expectedSignature === signature;
    } catch (error) {
        console.error("Razorpay signature verification failed:", error);
        return false;
    }
}

/**
 * Map payment gateway status to internal status
 * @param {string} gatewayStatus - Gateway specific status
 * @param {string} gateway - Payment gateway name
 * @returns {string} Internal status
 */
function mapGatewayStatus(gatewayStatus, gateway) {
    const statusMaps = {
        razorpay: {
            created: "pending",
            authorized: "pending",
            captured: "completed",
            failed: "failed",
            refunded: "refunded"
        },
        phonepe: {
            PAYMENT_INITIATED: "pending",
            PAYMENT_SUCCESS: "completed",
            PAYMENT_ERROR: "failed",
            PAYMENT_DECLINED: "failed"
        }
    };

    const statusMap = statusMaps[gateway.toLowerCase()] || {};
    return statusMap[gatewayStatus] || "pending";
}

/**
 * Create a standardized transaction object
 * @param {Object} params - Transaction parameters
 * @returns {Object} Transaction object
 */
function createTransactionObject(params) {
    const {
        amount,
        type = "payment",
        status = "pending",
        description,
        userId,
        org_id,
        payment_gateway,
        merchant_order_id,
        currency = "INR",
        net_amount,
        metadata = {}
    } = params;

    return {
        amount,
        type,
        status,
        description,
        userId: new mongoose.Types.ObjectId(userId),
        org_id: new mongoose.Types.ObjectId(org_id),
        payment_gateway,
        merchant_order_id,
        currency,
        net_amount: net_amount || amount,
        metadata,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

module.exports = {
    generateMerchantOrderId,
    validateAmount,
    convertToPaise,
    convertFromPaise,
    createTransactionMetadata,
    verifyRazorpaySignature,
    mapGatewayStatus,
    createTransactionObject
}; 