const mongoose = require("mongoose");

const { Schema } = mongoose;

// Flow Schema
const ReactFlowSchema = new Schema({
    title: { type: String, required: true },
    type: { type: String, required: true }, // e.g., 'reactflow', 'subflow',
    desc: { type: String, default: "" },
    nodes: [{ type: mongoose.Schema.Types.Mixed }],
    edges: [{ type: mongoose.Schema.Types.Mixed }],
    fs_flow_id: { type: mongoose.Schema.Types.ObjectId, ref: "FlowstoreFlow", required: true },
}, { timestamps: true });

module.exports = mongoose.model("ReactFlow", ReactFlowSchema);