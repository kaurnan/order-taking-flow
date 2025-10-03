const { Schema, model } = require("mongoose");

const ThirdPartyAppsSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    apiKey: {
        type: String,
        required: true,
        unique: true,
    },
    description: {
        type: String,
        default: "",
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Middleware to update the `updatedAt` field on save
ThirdPartyAppsSchema.pre("save", function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = model("ThirdPartyApp", ThirdPartyAppsSchema);