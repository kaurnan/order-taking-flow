const mongoose = require("mongoose");

const AccountUsageSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        index: true,
    },
    marketing: {
        qty: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
    },
    freeMarketing: {
        qty: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
    },
    utility: {
        qty: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
    },
    freeUtility: {
        qty: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
    },
    authentication: {
        qty: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
    },
    freeAuthentication: {
        qty: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
    },
    freeService: {
        qty: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
    },
    users: {
        type: Number,
        default: 0,
    },
    channels: {
        type: Number,
        default: 0,
    },
    branches: {
        type: Number,
        default: 0,
    },
    org_id: {
        type: mongoose.Types.ObjectId,
        ref: "Organisation",
        required: true,
        index: true,
    },
    conversation_count: {
        type: Number,
        default: 0,
    },
    message_count: {
        type: Number,
        default: 0,
    },
    total_cost: {
        type: Number,
        default: 0,
    },
    country_wise_data: {
        type: Object,
        default: {},
    },
}, {
    timestamps: true,
});

// Compound index for efficient queries
AccountUsageSchema.index({ org_id: 1, date: 1, }, { unique: true });

module.exports = mongoose.model("AccountUsage", AccountUsageSchema);
