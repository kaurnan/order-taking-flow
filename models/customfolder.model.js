const mongoose = require("mongoose");

const CustomFolderSchema = new mongoose.Schema({
    title: String,
    path: String,
    parent: String,
    meta: mongoose.Schema.Types.Mixed,
    branch_id: { type: mongoose.Schema.Types.ObjectId, ref: "branches" },
    channels: { type: [mongoose.Schema.Types.ObjectId], ref: "channels" }
}, {
    timestamps: true
});

CustomFolderSchema.index({ title: 1, branch_id: 1 }, { unique: true });

module.exports = mongoose.model("CustomFolders", CustomFolderSchema);
