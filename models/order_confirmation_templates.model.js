const mongoose = require('mongoose');

const OrderConfirmationTemplateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    language: {
        type: String,
        required: true,
        default: "en"
    },
    category: {
        type: String,
        enum: ["UTILITY", "MARKETING", "AUTHENTICATION"],
        required: true,
        default: "UTILITY"
    },
    status: {
        type: String,
        enum: ["PENDING", "APPROVED", "REJECTED", "DISABLED"],
        default: "PENDING"
    },
    components: [{
        type: {
            type: String,
            enum: ["HEADER", "BODY", "FOOTER", "BUTTONS"],
            required: true
        },
        format: {
            type: String,
            enum: ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"],
            required: false
        },
        text: {
            type: String,
            required: false
        },
        parameters: [{
            type: {
                type: String,
                enum: ["text", "image", "video", "document"],
                required: true
            },
            text: {
                type: String,
                required: false
            }
        }]
    }],
    whatsapp_template_id: {
        type: String,
        required: false
    },
    rejection_reason: {
        type: String,
        required: false
    },
    org_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    branch_id: {
        type: mongoose.Schema.Types.ObjectId,
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
    approved_at: {
        type: Date,
        required: false
    },
    submitted_at: {
        type: Date,
        required: false
    }
}, {
    timestamps: true,
    collection: 'order_confirmation_templates'
});

// Indexes for better performance
OrderConfirmationTemplateSchema.index({ name: 1, language: 1, org_id: 1 });
OrderConfirmationTemplateSchema.index({ org_id: 1, branch_id: 1 });
OrderConfirmationTemplateSchema.index({ status: 1 });
OrderConfirmationTemplateSchema.index({ whatsapp_template_id: 1 });

// Update the updated_at field before saving
OrderConfirmationTemplateSchema.pre('save', function(next) {
    this.updated_at = new Date();
    next();
});

module.exports = mongoose.model("OrderConfirmationTemplate", OrderConfirmationTemplateSchema);
