const mongoose = require("mongoose");

const { Schema } = mongoose;

const flowStatsSchema = new Schema({
    flow_id: { type: String, required: true },
    org_id: { type: String, required: true },
    branch_id: { type: String, required: true },
    total_triggered: { type: Number, default: 0 },
    total_completed: { type: Number, default: 0 },
    total_errored: { type: Number, default: 0 },
    total_ongoing: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    is_default: { type: Boolean, default: false },
}, { timestamps: true });

flowStatsSchema.index({ flow_id: 1, org_id: 1, branch_id: 1 }, { unique: true });
flowStatsSchema.index({ org_id: 1, branch_id: 1, cursor: 1 });

module.exports = mongoose.model("flow_stats", flowStatsSchema);