const mongoose = require("mongoose");

const CustomerImportSchema = new mongoose.Schema({
    title: { type: String },
    org_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    branch_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, required: true },
    customer_count: { type: Number },
    filecdn: { type: String },
    errorcdn: { type: String },
}, {
    timestamps: true
});

CustomerImportSchema.index({ title: "text" });
CustomerImportSchema.index({ title: 1, org_id: 1, branch_id: 1 });

module.exports = mongoose.model("CustomerImport", CustomerImportSchema);
