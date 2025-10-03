const mongoose = require("mongoose");
const { Schema } = mongoose;


const flowDataSchema = new Schema({
    campaign_id: { type: String },
    flow_id: { type: String },
    org_id: { type: String, required: true },
    branch_id: { type: String, required: true },
    title: { type: String, required: true },
    columns: { type: [String], default: [] },
    is_pinned: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("FlowDataTable", flowDataSchema);


