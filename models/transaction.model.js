const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
    amount: {
        type: Number,
        required: true,
    },
    type: {
        type: String,
        enum: ["subscription", "debit", "wallet", "refund", "usage_debit"],
        required: true,
    },
    status: {
        type: String,
        enum: ["pending", "completed", "failed", "cancelled"],
        default: "pending",
    },
    date: {
        type: Date,
        default: Date.now,
    },
    description: {
        type: String,
        trim: true,
    },
    userId: {
        type: mongoose.Types.ObjectId,
        ref: "User",
        required: true,
    },
    org_id: {
        type: mongoose.Types.ObjectId,
        ref: "Organisation",
        required: true,
    },
    // Payment gateway specific fields
    payment_gateway: {
        type: String,
        enum: ["phonepe", "razorpay", "stripe", "other"],
        required: false,
    },
    gateway_transaction_id: {
        type: String,
        required: false,
    },
    merchant_order_id: {
        type: String,
        required: false,
    },
    gateway_response: {
        type: mongoose.Schema.Types.Mixed,
        required: false,
    },
    currency: {
        type: String,
        default: "INR",
    },
    fee_amount: {
        type: Number,
        default: 0,
    },
    net_amount: {
        type: Number,
        required: false,
    },
    // Additional metadata
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        required: false,
    },
}, {
    timestamps: true,
});

// Indexes for better query performance
transactionSchema.index({ org_id: 1, date: -1 });
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ gateway_transaction_id: 1 });
transactionSchema.index({ merchant_order_id: 1 });
transactionSchema.index({ status: 1 });

const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
