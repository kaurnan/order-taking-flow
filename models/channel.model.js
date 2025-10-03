const mongoose = require("mongoose");

const ChannelsSchema = new mongoose.Schema({
    waba_id: { type: String, required: true },
    websites: { type: [String] },
    email: { type: String },
    description: { type: String },
    address: { type: String },
    org_id: {
        type: mongoose.Types.ObjectId,
        ref: "Organisation",
        required: true,
    },
    bsp: { type: String, required: true, default: "interakt" }, // Business Service Provider
    profile_picture_url: { type: String },
    phone_number_details: {
        verified_name: { type: String },
        code_verification_status: { type: String },
        display_phone_number: { type: String },
        quality_rating: { type: String },
        platform_type: { type: String },
        throughput: { type: mongoose.Schema.Types.Mixed },
        last_onboarded_time: { type: Date },
        webhook_configuration: { type: mongoose.Schema.Types.Mixed },
        messaging_limit_tier: { type: String, default: null },
        id: { type: String }
    },
    additional: {
        type: mongoose.Schema.Types.Mixed, // To store any additional information
        default: {}
    },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date } // Field to track when the document was marked as deleted
}, { timestamps: true });


ChannelsSchema.index({ description: "text", email: "text" });
// TTL index for automatic deletion after 30 days
ChannelsSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
// Middleware to set deletedAt when deleted is set to true
ChannelsSchema.pre("save", function (next) {
    if (this.deleted && !this.deletedAt) {
        this.deletedAt = new Date();
    }
    next();
});

module.exports = mongoose.model("channel", ChannelsSchema);
