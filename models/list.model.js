const mongoose = require("mongoose");

const ListsSchema = new mongoose.Schema({
    title: { type: String },
    description: { type: String },
    org_id: { type: String, required: true },
    branch_id: { type: String, required: true },
},
    {
        timestamps: true,
    });

ListsSchema.index({ title: "text" });
ListsSchema.index({ title: 1, org_id: 1, branch_id: 1 });

module.exports = mongoose.model("Lists", ListsSchema);
