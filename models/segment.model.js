const mongoose = require("mongoose");

const SegmentsSchema = new mongoose.Schema({
    title: { type: String },
    description: { type: String },
    org_id: { type: String, required: true },
    branch_id: { type: String, required: true },
    rules: { type: String, default: "" },
},
{
    timestamps: true,
});

SegmentsSchema.index({ title: "text" });
SegmentsSchema.index({ title: 1, org_id: 1, branch_id: 1 });

module.exports = mongoose.model("Segments", SegmentsSchema);
