const mongoose = require("mongoose");

const TagSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    org_id: { type: mongoose.Types.ObjectId, required: true, ref: "Organisation" },
    branch_id: { type: mongoose.Types.ObjectId, ref: "Branch" },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    type: { type: String, default: "customer" },
});

TagSchema.index({ org_id: 1, branch_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Tag", TagSchema);
