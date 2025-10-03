const mongoose = require("mongoose");

const MetaTemplateSchema = new mongoose.Schema({
    id: {
        type: String,
        required: false
    },
    waba_id: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    language: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: false
    },
    parameter_format: {
        type: String,
        required: false
    },
    components: {
        type: mongoose.Schema.Types.Mixed, // Allow any type for components
        required: false
    },
    status: {
        type: String,
        enum: ["approved", "pending", "rejected", "APPROVED", "PENDING", "REJECTED", "ERROR"],
        default: "pending"
    },
    error_msg: {
        type: String,
        required: false,
        trim: true
    }
});

const WhatsAppTemplateSchema = new mongoose.Schema({
    org_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: "Organisation"
    },
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    meta_templates: [MetaTemplateSchema],
    status: {
        type: String,
        default: "live"
    },
}, {
    timestamps: true
});

// Indexes
WhatsAppTemplateSchema.index({
    org_id: 1,
    "meta_templates.status": 1,
    createdAt: -1
});

WhatsAppTemplateSchema.index({
    name: "text"
});

WhatsAppTemplateSchema.index({
    "meta_templates.status": 1
});

module.exports = mongoose.model("WhatsAppTemplate", WhatsAppTemplateSchema);
