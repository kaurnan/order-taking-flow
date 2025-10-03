"use strict";

const crypto = require("crypto");
const config = require("../config/phonepe.config");

/**
 * PhonePe Utility Functions
 */
class PhonePeUtils {

    /**
     * Generate checksum for API requests
     * @param {Object} payload - Request payload
     * @param {string} saltKey - Salt key for checksum
     * @param {number} saltIndex - Salt index
     * @returns {string} - Generated checksum
     */
    static generateChecksum(payload, saltKey = config.saltKey, saltIndex = config.saltIndex) {
        try {
            const baseString = Object.keys(payload)
                .sort()
                .map(key => `${key}=${payload[key]}`)
                .join('&');

            const sha256 = crypto.createHash('sha256').update(baseString).digest('hex');
            return sha256 + "###" + saltIndex;
        } catch (error) {
            throw new Error(`Failed to generate checksum: ${error.message}`);
        }
    }

    /**
     * Verify webhook signature
     * @param {Object} payload - Webhook payload
     * @param {string} signature - Received signature
     * @param {string} saltKey - Salt key for verification
     * @param {number} saltIndex - Salt index
     * @returns {boolean} - True if signature is valid
     */
    static verifyWebhookSignature(payload, signature, saltKey = config.saltKey, saltIndex = config.saltIndex) {
        try {
            const baseString = `/pg/v1/status/${payload.merchantId}/${payload.merchantOrderId}` +
                payload.amount +
                payload.merchantOrderId +
                payload.transactionId +
                payload.providerReferenceId +
                payload.merchantOrderId;

            const sha256 = crypto.createHash('sha256').update(baseString).digest('hex');
            const checksum = sha256 + "###" + saltIndex;

            return checksum === signature;
        } catch (error) {
            console.error("Signature verification error:", error);
            return false;
        }
    }

    /**
     * Generate unique merchant order ID
     * @param {string} orgId - Organisation ID
     * @param {string} prefix - Order ID prefix
     * @returns {string} - Generated merchant order ID
     */
    static generateMerchantOrderId(orgId, prefix = config.transaction.merchantOrderIdPrefix) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `${prefix}${orgId}_${timestamp}_${random}`;
    }

    /**
     * Validate payment amount
     * @param {number} amount - Payment amount
     * @returns {Object} - Validation result
     */
    static validateAmount(amount) {
        const { min, max, precision } = config.validation.amount;

        if (typeof amount !== 'number' || isNaN(amount)) {
            return { valid: false, error: "Amount must be a valid number" };
        }

        if (amount < min) {
            return { valid: false, error: `Amount must be at least ${min}` };
        }

        if (amount > max) {
            return { valid: false, error: `Amount cannot exceed ${max}` };
        }

        // Check precision
        const decimalPlaces = amount.toString().split('.')[1]?.length || 0;
        if (decimalPlaces > precision) {
            return { valid: false, error: `Amount can have maximum ${precision} decimal places` };
        }

        return { valid: true };
    }

    /**
     * Validate merchant order ID
     * @param {string} orderId - Merchant order ID
     * @returns {Object} - Validation result
     */
    static validateMerchantOrderId(orderId) {
        const { maxLength, pattern } = config.validation.merchantOrderId;

        if (!orderId || typeof orderId !== 'string') {
            return { valid: false, error: "Merchant order ID is required" };
        }

        if (orderId.length > maxLength) {
            return { valid: false, error: `Merchant order ID cannot exceed ${maxLength} characters` };
        }

        if (!pattern.test(orderId)) {
            return { valid: false, error: "Merchant order ID contains invalid characters" };
        }

        return { valid: true };
    }

    /**
     * Convert amount to paise (PhonePe expects amount in paise)
     * @param {number} amount - Amount in rupees
     * @returns {number} - Amount in paise
     */
    static convertToPaise(amount) {
        return Math.round(amount * 100);
    }

    /**
     * Convert amount from paise to rupees
     * @param {number} paise - Amount in paise
     * @returns {number} - Amount in rupees
     */
    static convertFromPaise(paise) {
        return paise / 100;
    }

    /**
     * Map PhonePe status to internal status
     * @param {string} phonepeStatus - PhonePe status
     * @returns {string} - Internal status
     */
    static mapPhonePeStatus(phonepeStatus) {
        const statusMap = {
            "PAYMENT_SUCCESS": "completed",
            "PAYMENT_ERROR": "failed",
            "PAYMENT_DECLINED": "failed",
            "PAYMENT_PENDING": "pending",
            "PAYMENT_CANCELLED": "cancelled",
            "PAYMENT_INITIATED": "pending",
            "PAYMENT_PROCESSING": "pending"
        };
        return statusMap[phonepeStatus] || "pending";
    }

    /**
     * Map internal status to PhonePe status
     * @param {string} internalStatus - Internal status
     * @returns {string} - PhonePe status
     */
    static mapToPhonePeStatus(internalStatus) {
        const statusMap = {
            "completed": "PAYMENT_SUCCESS",
            "failed": "PAYMENT_ERROR",
            "pending": "PAYMENT_PENDING",
            "cancelled": "PAYMENT_CANCELLED"
        };
        return statusMap[internalStatus] || "PAYMENT_PENDING";
    }

    /**
     * Sanitize sensitive data for logging
     * @param {Object} data - Data to sanitize
     * @param {Array} sensitiveFields - Fields to mask
     * @returns {Object} - Sanitized data
     */
    static sanitizeForLogging(data, sensitiveFields = ['clientSecret', 'saltKey', 'token', 'signature']) {
        if (!config.logging.includeSensitiveData) {
            const sanitized = { ...data };
            sensitiveFields.forEach(field => {
                if (sanitized[field]) {
                    sanitized[field] = '***MASKED***';
                }
            });
            return sanitized;
        }
        return data;
    }

    /**
     * Create error response object
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {Object} details - Additional error details
     * @returns {Object} - Error response
     */
    static createErrorResponse(message, code = "PAYMENT_ERROR", details = {}) {
        return {
            success: false,
            error: {
                message,
                code,
                details,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Create success response object
     * @param {string} message - Success message
     * @param {Object} data - Response data
     * @returns {Object} - Success response
     */
    static createSuccessResponse(message, data = {}) {
        return {
            success: true,
            message,
            data,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Validate IP address against whitelist
     * @param {string} ipAddress - IP address to validate
     * @returns {boolean} - True if IP is whitelisted
     */
    static validateIpAddress(ipAddress) {
        if (!config.security.ipWhitelist || config.security.ipWhitelist.length === 0) {
            return true; // No whitelist configured, allow all
        }

        return config.security.ipWhitelist.includes(ipAddress);
    }

    /**
     * Retry function with exponential backoff
     * @param {Function} fn - Function to retry
     * @param {number} maxRetries - Maximum retry attempts
     * @param {number} baseDelay - Base delay in milliseconds
     * @returns {Promise} - Function result
     */
    static async retryWithBackoff(fn, maxRetries = config.errorHandling.maxRetries, baseDelay = config.errorHandling.retryDelay) {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;

                if (attempt === maxRetries) {
                    throw error;
                }

                const delay = baseDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Format currency amount
     * @param {number} amount - Amount to format
     * @param {string} currency - Currency code
     * @returns {string} - Formatted amount
     */
    static formatCurrency(amount, currency = "INR") {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: currency
        }).format(amount);
    }

    /**
     * Generate transaction reference
     * @param {string} orgId - Organisation ID
     * @param {string} type - Transaction type
     * @returns {string} - Transaction reference
     */
    static generateTransactionReference(orgId, type = "payment") {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 6);
        return `${type.toUpperCase()}_${orgId}_${timestamp}_${random}`;
    }
}

module.exports = PhonePeUtils; 