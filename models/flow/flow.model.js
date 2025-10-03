const mongoose = require("mongoose");

const { Schema } = mongoose;

// Flow Schema
const flowSchema = new Schema({
    org_id: { type: String, required: true },
    branch_id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String },
    status: { type: String, default: "Draft" },
    is_free: { type: Boolean, default: true },
    price: { type: Number, default: 0 },
    is_recurring: { type: Boolean, default: false },
    platform: { type: String },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: "channels", required: true },
    fe_flow: {
        nodes: [{ type: mongoose.Schema.Types.Mixed }],
        edges: [{ type: mongoose.Schema.Types.Mixed }],
    },
    custom_trigger_id: { type: String, default: null },
    version: { type: Number, default: 1 },
    is_default: { type: Boolean, default: false },
    flowstore_ref: { type: mongoose.Schema.Types.ObjectId, ref: "flowstoreflows", default: null },
}, { timestamps: true });

flowSchema.index({ org_id: 1, branch_id: 1, title: 1 }, { unique: true });
flowSchema.index({ title: "text", description: "text" }, { weights: { title: 3, description: 2 } });

module.exports = mongoose.model("flow", flowSchema);