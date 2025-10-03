const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const InvoiceSchema = new Schema({
    org_id: {
        type: Schema.Types.ObjectId,
        ref: "Organisation", // Assuming 'Organisation' is the model name for organizations
        required: true,
    },
    invoiceDate: {
        type: Date,
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ["pending", "paid", "cancelled"],
        default: "pending",
    },
    invoiceNumber: {
        type: String,
        required: true,
        unique: true,
    },
    dueDate: {
        type: Date,
        required: true,
    },
    file: {
        type: String,
        optional: true, // Assuming it's optional as it's a CDN link
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model("Invoice", InvoiceSchema);
