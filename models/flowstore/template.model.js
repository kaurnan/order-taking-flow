const mongoose = require("mongoose");

const TemplateSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true },
    category: { type: String, required: true },
    language: { type: String, required: true },
    components: { type: mongoose.Schema.Types.Mixed }, // Changed to Mixed
    status: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model("FlowstoreTemplate", TemplateSchema);
