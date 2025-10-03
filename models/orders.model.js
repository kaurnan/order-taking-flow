const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    shopify_order_id: {
        type: String,
        required: true,
        unique: true
    },
    order_number: {
        type: String,
        required: true
    },
    customer_name: {
        type: String,
        required: true
    },
    customer_email: {
        type: String,
        required: false
    },
    customer_phone: {
        type: String,
        required: false
    },
    customer_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
        required: false
    },
    total_amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        required: true,
        default: "USD"
    },
    items: [{
        name: String,
        quantity: Number,
        price: Number,
        total: Number
    }],
    shipping_address: {
        address1: String,
        address2: String,
        city: String,
        province: String,
        country: String,
        zip: String
    },
    status: {
        type: String,
        enum: ["processing", "completed", "failed", "cancelled"],
        default: "processing"
    },
    workflow_id: {
        type: String,
        required: false
    },
    workflow_status: {
        type: String,
        enum: ["started", "completed", "failed", "cancelled"],
        required: false
    },
    message_sent: {
        type: Boolean,
        default: false
    },
    message_id: {
        type: String,
        required: false
    },
    error_message: {
        type: String,
        required: false
    },
    retry_count: {
        type: Number,
        default: 0
    },
    org_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    branch_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    order_data: {
        type: Object,
        required: true
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    },
    completed_at: {
        type: Date,
        required: false
    },
    failed_at: {
        type: Date,
        required: false
    }
});

// Indexes for better performance
orderSchema.index({ shopify_order_id: 1, org_id: 1 });
orderSchema.index({ org_id: 1, branch_id: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ workflow_id: 1 });
orderSchema.index({ created_at: -1 });

// Update the updated_at field before saving
orderSchema.pre('save', function(next) {
    this.updated_at = new Date();
    next();
});

module.exports = mongoose.model("Order", orderSchema);
