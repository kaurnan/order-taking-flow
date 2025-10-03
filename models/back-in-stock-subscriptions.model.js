const mongoose = require("mongoose");

const BackInStockSubscriptionSchema = new mongoose.Schema({
    product_id: {
        type: String,
        required: true,
        index: true
    },
    product_title: {
        type: String,
        required: true
    },
    variant_id: {
        type: String,
        required: false // Optional for variant-specific subscriptions
    },
    variant_title: {
        type: String,
        required: false
    },
    customer_email: {
        type: String,
        required: false,
        index: true
    },
    customer_phone: {
        type: String,
        required: false,
        index: true
    },
    customer_name: {
        type: String,
        required: false
    },
    shopify_shop_domain: {
        type: String,
        required: true,
        index: true
    },
    org_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Organisation",
        required: true,
        index: true
    },
    branch_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
        required: false,
        index: true
    },
    status: {
        type: String,
        enum: ["active", "notified", "expired", "cancelled"],
        default: "active"
    },
    notification_sent: {
        type: Boolean,
        default: false
    },
    notification_sent_at: {
        type: Date,
        required: false
    },
    min_stock_threshold: {
        type: Number,
        default: 5
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
});

// Compound indexes for efficient queries
BackInStockSubscriptionSchema.index({ product_id: 1, status: 1 });
BackInStockSubscriptionSchema.index({ shopify_shop_domain: 1, product_id: 1, status: 1 });
BackInStockSubscriptionSchema.index({ org_id: 1, status: 1 });

// TTL index to auto-expire subscriptions after 90 days
BackInStockSubscriptionSchema.index(
    { created_at: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 } // 90 days
);

module.exports = mongoose.model("BackInStockSubscription", BackInStockSubscriptionSchema);
