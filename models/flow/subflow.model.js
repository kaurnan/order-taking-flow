const mongoose = require("mongoose");

const { Schema } = mongoose;

const SubflowSchema = new Schema({
    title: { type: String, required: true },
    description: { type: String },
    pflow_id: { type: Schema.Types.ObjectId, ref: "flows", required: true },
    rflow_def: { type: Schema.Types.Mixed, required: true },
    gcp_source: { type: Schema.Types.Mixed, default: {} },
    branch_id: { type: Schema.Types.ObjectId, ref: "branches", required: true },
}, { timestamps: true });

SubflowSchema.index({ pflow_id: 1, branch_id: 1, title: 1 }, { unique: true });

module.exports = mongoose.model("subflow", SubflowSchema);