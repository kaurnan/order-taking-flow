const mongoose = require("mongoose");

const CustomerSchema = new mongoose.Schema(
    {
        reference: { type: String },
        email: {
            type: String,
            match: [/.+\@.+\..+/, "Please fill a valid email address"],
        },
        name: { type: String },
        country: { type: String },
        state: { type: String },
        note: { type: String },
        verified_email: { type: Boolean },
        tags: { type: [mongoose.Types.ObjectId], ref: "tags" },
        lists: { type: [mongoose.Types.ObjectId], ref: "lists", default: [] },
        phone: {
            type: String,
            sparse: true, // Allows null values but ensures uniqueness
        },
        addresses: [String],
        tax_exemptions: [String],
        email_marketing_consent: { type: Boolean, default: true },
        sms_marketing_consent: { type: Boolean, default: true },
        whatsapp_marketing_consent: { type: Boolean, default: true },
        org_id: { type: mongoose.Types.ObjectId, required: true, ref: "organisations" },
        branch_id: { type: mongoose.Types.ObjectId, required: true, ref: "branches" },
        meta: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    { timestamps: true }
);

// Custom Validation
CustomerSchema.pre("validate", function (next) {
    if (!this.phone) {
        next(new Error("Phone must be provided."));
    } else {
        next();
    }
});

// Indexes
CustomerSchema.index({ branch_id: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $exists: true } } });
CustomerSchema.index({ org_id: 1, branch_id: 1, _id: -1 })
CustomerSchema.index({ name: "text", email: "text", phone: "text" });
CustomerSchema.index({ org_id: 1, branch_id: 1, deleted: 1, cursor: 1, name: 1, email: 1, phone: 1 });
CustomerSchema.index({ org_id: 1, branch_id: 1, deleted: 1, cursor: -1, name: 1, email: 1, phone: 1 });
CustomerSchema.index({ lists: 1 });
CustomerSchema.index({ "tags.id": 1 }, { unique: true, sparse: true });
CustomerSchema.index({ type: 1 });
CustomerSchema.index({ email_marketing_consent: 1 });
CustomerSchema.index({ sms_marketing_consent: 1 });
CustomerSchema.index({ whatsapp_marketing_consent: 1 });
CustomerSchema.index({ email_marketing_consent: 1, sms_marketing_consent: 1, whatsapp_marketing_consent: 1 });
CustomerSchema.index({ order_count: 1 });
CustomerSchema.index({ "meta.shopify.orders_count": 1 });
CustomerSchema.index({ "meta.shopify.total_spent": 1 });
CustomerSchema.index({ "meta.shopify.last_order_id": 1 });
CustomerSchema.index({ "meta.shopify.last_order_name": 1 });
CustomerSchema.index({ "meta.shopify.tags": 1 });
CustomerSchema.index({ "meta.shopify.admin_graphql_api_id": 1 });

// Optimized compound indexes to support anchored prefix searches by org/branch
CustomerSchema.index({ org_id: 1, branch_id: 1, name: 1 });
CustomerSchema.index({ org_id: 1, branch_id: 1, email: 1 });
CustomerSchema.index({ org_id: 1, branch_id: 1, phone: 1 });

CustomerSchema.set("toJSON", {
    transform: function (doc, ret, options) {
        delete ret.__v;
    },
});

module.exports = mongoose.model("Customer", CustomerSchema);
