const mongoose = require("mongoose");

const SharedWabaPhonesSchema = new mongoose.Schema({
    verified_name: {
        type: String,
        required: true,
        trim: true,
    },
    display_phone_number: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    quality_rating: {
        type: String,
        required: true,
    },
    phone_id: {
        type: String,
        required: true,
        unique: true,
    },
    org_id: {
        type: mongoose.Types.ObjectId,
        ref: "Organisation",
        required: true,
    },
}, {
    timestamps: true, // Adds createdAt and updatedAt fields
});

module.exports = mongoose.model("SharedWabaPhone", SharedWabaPhonesSchema);