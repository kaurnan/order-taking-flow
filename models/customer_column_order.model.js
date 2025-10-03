const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CustomerColumnOrderSchema = new Schema({
    org_id: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "Organisation"
    },
    branch_id: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "Branch"
    },
    columns: [
        {
            key: {
                type: String,
                required: true,
            },
            type: {
                type: String,
                required: true,
            },
            label: {
                type: String,
                required: true,
            },
        },
    ],
}, {
    timestamps: true,
});

module.exports = mongoose.model("CustomerColumnOrder", CustomerColumnOrderSchema);
