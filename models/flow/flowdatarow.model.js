const mongoose = require("mongoose");
const { Schema } = mongoose;

const rowSchema = new Schema({
    table_ref: { type: Schema.Types.ObjectId, ref: "FlowDataTable" }, // Reference to Flow document
    branch_id: { type: String, required: true },
    columns: {
        type: Map,
        of: Schema.Types.Mixed, // Arbitrary values for each dynamic key
    },
}, { timestamps: true });

module.exports = mongoose.model("FlowDataRow", rowSchema);