const mongoose = require("mongoose");

const BroadcastSchema = new mongoose.Schema({
    title: { type: String },
    status: {
        type: String,
        enum: ["draft", "active", "completed", "paused", "cancelled", "failed"],
        default: "draft",
    },
    template: {
        type: { type: String, enum: ["whatsapp", "workflow"] },
        template_id: { type: String },
        template_json: { type: mongoose.Schema.Types.Mixed }, // JSON for template data
    },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: "Channel" },
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: "Organisation", required: true },
    branch_id: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true },
    audience_cat: { type: String, enum: ["list", "segment", "manual"] },
    list_ref: [{ type: mongoose.Schema.Types.ObjectId, ref: "Lists" }],
    segment_ref: [{ type: mongoose.Schema.Types.ObjectId, ref: "Segments" }],
    manual_ref: [{ type: mongoose.Schema.Types.ObjectId, ref: "Customers" }],
    stats: {
        total_enqueued: { type: Number, default: 0 },
        total_failed: { type: Number, default: 0 },
        total_sent: { type: Number, default: 0 },
        total_delivered: { type: Number, default: 0 },
        total_read: { type: Number, default: 0 },
        total_clicked: { type: Number, default: 0 },
        total_replied: { type: Number, default: 0 },
        total_recipients: { type: Number, default: 0 },
    },
    jobs: [{
        id: { type: String },
        name: { type: String },
        queue: { type: String },
        opts: { type: Object },
        timestamp: { type: Date },
        status: { type: String, enum: ["scheduled", "in_progress", "completed", "failed"], default: "scheduled" },
        batchNumber: { type: Number },
        startId: { type: Number },
        endId: { type: Number },
        customerCount: { type: Number },
        processedCustomers: { type: Number },
        completedAt: { type: Date },
        failedAt: { type: Date },
        error: { type: String },
        chunkOffset: { type: Number },
        chunkSize: { type: Number },
        totalProcessed: { type: Number }
    }],
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    retry: { type: Boolean, default: false },
    offsetMinutes: { type: Number },
    completed_at: { type: Date },
    delay: { type: Number, default: 0 },
}, {
    timestamps: true,
});

BroadcastSchema.index({ title: 1 });
BroadcastSchema.index({ title: "text" });

module.exports = mongoose.model("broadcast", BroadcastSchema);
