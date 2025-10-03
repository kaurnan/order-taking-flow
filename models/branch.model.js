const mongoose = require("mongoose");

const BranchesSchema = new mongoose.Schema({
    name: { type: String },
    org_id: {
        type: mongoose.Types.ObjectId,
        ref: "Organisation",
        required: true,
    },
    profile_img: { type: String },
    currency: { type: String },
    location: {
        formatted_address: { type: String },
        latitude: { type: Number },
        longitude: { type: Number }
    },
    timezone: { type: String },
}, { timestamps: true });

BranchesSchema.index({ name: 1, org_id: 1 }, { unique: true });
BranchesSchema.index({ name: "text" });
BranchesSchema.index({ deleted: 1 });
BranchesSchema.index({ deleted_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("branch", BranchesSchema);
