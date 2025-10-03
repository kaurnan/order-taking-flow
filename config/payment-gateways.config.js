/**
 * Payment Gateway Configuration
 * This file contains configuration for all supported payment gateways
 */

module.exports = {
    // PhonePe Configuration
    phonepe: {
        name: "PhonePe",
        description: "Pay using PhonePe UPI, cards, and wallets",
        logo: "phonepe-logo.png",
        enabled: true,
        min_amount: 1,
        max_amount: 100000,
        supported_currencies: ["INR"],
        features: ["upi", "cards", "wallets", "netbanking"],
        environment: process.env.PHONEPE_CLIENT_ENV || "SANDBOX",
        client_id: process.env.PHONEPE_CLIENT_ID,
        client_secret: process.env.PHONEPE_CLIENT_SECRET,
        salt_key: process.env.PHONEPE_SALT_KEY,
        salt_index: process.env.PHONEPE_SALT_INDEX || 1
    },

    // Razorpay Configuration
    razorpay: {
        name: "Razorpay",
        description: "Pay using UPI, cards, netbanking, and wallets",
        logo: "razorpay-logo.png",
        enabled: true,
        min_amount: 1,
        max_amount: 100000,
        supported_currencies: ["INR"],
        features: ["upi", "cards", "netbanking", "wallets"],
        environment: process.env.RAZORPAY_ENVIRONMENT || "test",
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
        webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET
    },

    // Common configuration
    common: {
        default_currency: "INR",
        supported_currencies: ["INR"],
        transaction_timeout: 30 * 60 * 1000, // 30 minutes
        retry_attempts: 3,
        webhook_timeout: 10 * 1000 // 10 seconds
    }
}; 