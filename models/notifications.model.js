const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
    {
        organisation_id: {
            type: mongoose.Types.ObjectId,
            required: true,
            ref: "Organisation",
        },
        branch_id: {
            type: mongoose.Types.ObjectId,
            ref: "Branch",
            default: null, // Nullable field
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        type: {
            type: String,
            required: true,
            enum: ["chat", "system_alert", "task_assigned"], // Add more types as needed
        },
        entity_type: {
            type: String,
            required: true,
        },
        entity_id: {
            type: mongoose.Types.ObjectId,
            required: true,
        },
        priority: {
            type: String,
            required: true,
            enum: ["high", "medium", "low"],
        },
        status: {
            type: String,
            required: true,
            enum: ["active", "archived"],
        },
        created_by: {
            type: mongoose.Types.ObjectId,
            required: true,
            ref: "User",
        },
        created_at: {
            type: Date,
            default: Date.now,
        },
        updated_at: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

// Add TTL index for 3 months expiration
NotificationSchema.index(
    { created_at: 1 },
    { expireAfterSeconds: 3 * 30 * 24 * 60 * 60 } // 3 months in seconds
);

module.exports = mongoose.model("Notification", NotificationSchema);