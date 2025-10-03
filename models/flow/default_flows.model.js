const mongoose = require("mongoose");

const { Schema } = mongoose;

const nodeSchema = new Schema(
    {
        id: { type: String, required: true },
        type: { type: String, required: true },
        targetPosition: { type: String },
        position: {
            x: { type: Number, required: true },
            y: { type: Number, required: true },
        },
        data: {
            type: { type: String },
            description: { type: String },
            title: { type: String },
            meta: { type: mongoose.Schema.Types.Mixed },
            config: { type: mongoose.Schema.Types.Mixed },
        },
    },
    { _id: false }
); // Disable _id for subdocuments

// Edge Schema
const edgeSchema = new Schema(
    {
        id: { type: String, required: true },
        source: { type: String, required: true },
        target: { type: String, required: true },
    },
    { _id: false }
); // Disable _id for subdocuments

const defaultflowschema = new Schema({
    profile_img: { type: String },
    title: { type: String, required: true },
    description: { type: String },
    is_free: { type: Boolean, default: true },
    price: { type: Number, default: 0 },
    is_recurring: { type: Boolean, default: false },
    tags: { type: [String], default: [] },
    fe_flow: {
        nodes: [nodeSchema],
        edges: [edgeSchema],
    },
    platform: { type: String },
    channels: { type: [String] },
    category: { type: String },
    is_default: { type: Boolean, default: true },
    cursor: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    version: { type: Number, default: 1 },
});

defaultflowschema.index({ title: "text", description: "text" });

module.exports = mongoose.model("default_flows", defaultflowschema);