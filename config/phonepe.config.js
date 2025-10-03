"use strict";

module.exports = {
    // PhonePe API Configuration
    clientId: process.env.PHONEPE_CLIENT_ID || "<clientId>",
    clientSecret: process.env.PHONEPE_CLIENT_SECRET || "<clientSecret>",
    clientVersion: process.env.PHONEPE_CLIENT_VER || 1,
    saltKey: process.env.PHONEPE_SALT_KEY || "<saltKey>",
    saltIndex: process.env.PHONEPE_SALT_INDEX || 1,

    // Environment (SANDBOX/PRODUCTION)
    environment: process.env.PHONEPE_CLIENT_ENV || "SANDBOX",

    // API Endpoints
    endpoints: {
        sandbox: {
            baseUrl: "https://api-preprod.phonepe.com/apis",
            checkoutUrl: "https://checkout-preprod.phonepe.com"
        },
        production: {
            baseUrl: "https://api.phonepe.com/apis",
            checkoutUrl: "https://checkout.phonepe.com"
        }
    },

    // Webhook Configuration
    webhook: {
        secret: process.env.PHONEPE_WEBHOOK_SECRET || "webhook_secret",
        signatureHeader: "x-verify",
        timeout: 30000 // 30 seconds
    },

    // Payment Configuration
    payment: {
        minAmount: 1, // Minimum amount in INR
        maxAmount: 100000, // Maximum amount in INR
        currency: "INR",
        defaultRedirectUrl: process.env.FRONTEND_URL + "/payment/callback",
        successUrl: process.env.FRONTEND_URL + "/payment/success",
        failureUrl: process.env.FRONTEND_URL + "/payment/failure"
    },

    // Transaction Configuration
    transaction: {
        merchantOrderIdPrefix: "WALLET_",
        refundOrderIdPrefix: "REFUND_",
        orderIdLength: 20,
        retryAttempts: 3,
        retryDelay: 5000 // 5 seconds
    },

    // Logging Configuration
    logging: {
        enabled: process.env.PHONEPE_LOGGING_ENABLED === "true",
        level: process.env.PHONEPE_LOG_LEVEL || "info",
        includeSensitiveData: process.env.PHONEPE_LOG_SENSITIVE === "true"
    },

    // Rate Limiting
    rateLimit: {
        enabled: process.env.PHONEPE_RATE_LIMIT_ENABLED === "true",
        maxRequests: parseInt(process.env.PHONEPE_RATE_LIMIT_MAX) || 100,
        windowMs: parseInt(process.env.PHONEPE_RATE_LIMIT_WINDOW) || 60000 // 1 minute
    },

    // Error Handling
    errorHandling: {
        maxRetries: 3,
        retryDelay: 1000,
        timeout: 30000
    },

    // Validation Rules
    validation: {
        amount: {
            min: 1,
            max: 100000,
            precision: 2
        },
        merchantOrderId: {
            maxLength: 50,
            pattern: /^[A-Za-z0-9_-]+$/
        },
        description: {
            maxLength: 500
        }
    },

    // Notification Configuration
    notifications: {
        email: {
            enabled: process.env.PHONEPE_EMAIL_NOTIFICATIONS === "true",
            templates: {
                paymentSuccess: "payment_success",
                paymentFailed: "payment_failed",
                refundProcessed: "refund_processed"
            }
        },
        sms: {
            enabled: process.env.PHONEPE_SMS_NOTIFICATIONS === "true"
        },
        webhook: {
            enabled: process.env.PHONEPE_WEBHOOK_NOTIFICATIONS === "true"
        }
    },

    // Security Configuration
    security: {
        signatureVerification: process.env.PHONEPE_SIGNATURE_VERIFICATION !== "false",
        ipWhitelist: process.env.PHONEPE_IP_WHITELIST ?
            process.env.PHONEPE_IP_WHITELIST.split(",") : [],
        requestTimeout: parseInt(process.env.PHONEPE_REQUEST_TIMEOUT) || 30000
    }
}; 