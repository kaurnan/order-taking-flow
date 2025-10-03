const mongoose = require("mongoose");

const OrganisationSchema = new mongoose.Schema(
    {
        name: { type: String },
        country: { type: String },
        currency: { type: String },
        website: { type: String },
        wallet: { type: mongoose.Types.ObjectId, ref: "Wallet", default: null },
        branches: [{ type: mongoose.Types.ObjectId, ref: "Branch" }],
        profile_image: { type: String },
        def_notify_email: { type: String },
        def_notify_whatsapp: { type: String },
        plan: { type: mongoose.Schema.Types.Mixed },
        trial_end_date: { type: Date, default: null },
        business_address: {
            address1: { type: String },
            state: { type: String },
            city: { type: String },
            zip: { type: String },
        },
        meta: { type: mongoose.Schema.Types.Mixed }, // JSON for additional data
        gcp_regions: [String],
    },
    { timestamps: true } // Adds createdAt and updatedAt fields
);

OrganisationSchema.index({ name: 1 });
OrganisationSchema.index({ country: 1 });

module.exports = mongoose.model("Organisation", OrganisationSchema);
