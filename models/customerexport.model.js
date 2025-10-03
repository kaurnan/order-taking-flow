const mongoose = require("mongoose");

const CustomerExportSchema = new mongoose.Schema({
    title: { type: String },
    org_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    branch_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, required: true },
    customer_count: { type: Number },
    filecdn: { type: String }
}, {
    timestamps: true
});

CustomerExportSchema.index({ title: "text" });
CustomerExportSchema.index({ cursor: 1, title: 1, org_id: 1, branch_id: 1, deleted: 1 });

module.exports = mongoose.model("CustomerExport", CustomerExportSchema);
