const mongoose = require("mongoose");

const { Schema } = mongoose;

const FlowstoreFlowsSchema = new Schema({
    listing_id: {
        type: Schema.Types.ObjectId,
        ref: "flowstoreList",
        required: true,
    },
    templates: [
        {
            type: Schema.Types.ObjectId,
            ref: "flowstoreTemplates",
        },
    ],
    outcome: {
        name: {
            type: String,
            required: true,
        },
        columns: [
            {
                type: String,
            },
        ],
    },
    tags: [
        {
            type: Schema.Types.ObjectId,
            ref: "tags",
        },
    ],
    mflow: {
        type: Schema.Types.ObjectId,
        ref: "ReactFlow",
    },
    sflows: [
        {
            type: Schema.Types.ObjectId,
            ref: "ReactFlow",
        },
    ],
});

module.exports = mongoose.model("FlowstoreFlow", FlowstoreFlowsSchema);