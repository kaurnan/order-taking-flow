const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema({
    topic: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String },
    sample_payload: { type: mongoose.Schema.Types.Mixed, required: true },
    category: { type: String, default: null },
}, { _id: false });

const TriggerSchema = new mongoose.Schema({
    description: { type: String, required: true },
    events: { type: [EventSchema], required: true },
    title: { type: String, required: true },
    type: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("Trigger", TriggerSchema);