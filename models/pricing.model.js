const mongoose = require("mongoose");

const PricingSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    type: {
        type: String,
        enum: ["one-time", "subscription", "custom", "freemium"],
        required: true,
        default: "subscription"
    },
    pricing: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: "USD",
        uppercase: true
    },
    billing_cycle: {
        type: String,
        enum: ["monthly", "yearly", "quarterly", "one-time"],
        default: "monthly"
    },
    pg: {
        type: String,
        enum: ["phonepe", "lemon_squeezy", "stripe", "razorpay"],
        required: true
    },
    desc: {
        type: String,
        trim: true
    },
    features: [{
        name: { type: String, required: true },
        description: { type: String },
        included: { type: Boolean, default: true },
        limit: { type: Number, default: -1 }, // -1 means unlimited
        unit: { type: String, default: "count" }, // count, minutes, GB, etc.
        category: { type: String, default: "general" } // marketing, segmentation, other, etc.
    }],
    limits: {
        users: { type: Number, default: 1 },
        additional_user_cost: { type: Number, default: 0 },
        branches: { type: Number, default: 1 },
        additional_branch_cost: { type: Number, default: 0 },
        workflows: { type: Number, default: 5 },
        test_workflows: { type: Number, default: -1 }, // -1 for unlimited
        channels: { type: Number, default: 1 },
        additional_channel_cost: { type: Number, default: 0 },
        storage: { type: Number, default: 1 }, // in GB
        api_calls: { type: Number, default: 1000 },
        messages: { type: Number, default: 1000 },
        integrations: { type: Number, default: 1 },
        custom_fields: { type: Number, default: 5 },
        templates: { type: Number, default: 10 }
    },
    plan_id: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    is_popular: {
        type: Boolean,
        default: false
    },
    is_active: {
        type: Boolean,
        default: true
    },
    sort_order: {
        type: Number,
        default: 0
    },
    trial_days: {
        type: Number,
        default: 0
    },
    setup_fee: {
        type: Number,
        default: 0
    },
    discount_percentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    discount_valid_until: {
        type: Date
    },
    yearly_discount_percentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for discounted price
PricingSchema.virtual('discounted_price').get(function () {
    if (this.discount_percentage > 0 &&
        (!this.discount_valid_until || this.discount_valid_until > new Date())) {
        return this.pricing * (1 - this.discount_percentage / 100);
    }
    return this.pricing;
});

// Virtual for total price including setup fee
PricingSchema.virtual('total_price').get(function () {
    return this.discounted_price + this.setup_fee;
});

// Virtual for yearly pricing
PricingSchema.virtual('yearly_pricing').get(function () {
    if (this.billing_cycle === 'yearly') {
        return this.pricing * 12 * (1 - this.yearly_discount_percentage / 100);
    }
    return this.pricing * 12;
});

// Virtual for monthly equivalent of yearly pricing
PricingSchema.virtual('yearly_monthly_equivalent').get(function () {
    return this.yearly_pricing / 12;
});

// Indexes for better query performance
PricingSchema.index({ type: 1, is_active: 1 });
PricingSchema.index({ sort_order: 1 });
PricingSchema.index({ is_popular: 1, is_active: 1 });

const Pricing = mongoose.model("Pricing", PricingSchema);

module.exports = Pricing;