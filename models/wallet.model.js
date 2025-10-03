const mongoose = require("mongoose");

const WalletSchema = new mongoose.Schema({
    balance: {
        type: Number,
        required: true,
    },
    threshold: {
        type: Number,
        required: true,
        default: 5,
    },
    min_balance: {
        type: Number,
        required: true,
        default: 10,
    },
    additional_email: {
        type: [String],
        default: [],
    },
    phone: {
        type: [String],
        default: [],
    },
    org_id: {
        type: mongoose.Types.ObjectId,
        ref: "Organisation",
        required: true,
    },
    lastRechargeAmount: {
        type: Number,
        default: 0,
    },
    monthlyUsage: {
        type: Number,
        default: 0,
    },
    usageSinceLastRecharge: {
        type: Number,
        default: 0,
    },
    total_usage: {
        type: Number,
        default: 0,
    },
    total_recharged: {
        type: Number,
        default: 0,
    },
}, {
    timestamps: true,
});

WalletSchema.methods.getBalance = function () {
    return this.balance;
};

module.exports = mongoose.model("Wallet", WalletSchema);
