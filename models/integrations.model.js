const { Schema, model } = require("mongoose");

const IntegrationSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        type: {
            type: String,
            required: true,
            enum: ["API", "Webhook", "Other"],
        },
        config: {
            type: Object,
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        branch_id: {
            type: Schema.Types.ObjectId,
            ref: "branch",
        },
        org_id: {
            type: Schema.Types.ObjectId,
            ref: "Organisation",
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = model("Integration", IntegrationSchema);