const mongoose = require("mongoose");

const usersSchema = new mongoose.Schema({
    full_name: { type: String, default: null },
    email: { type: String, default: null },
    availability: { type: Boolean, default: true },
    password: { type: String, default: null },
    profile_pic: { type: String, default: null },
    status: {
        type: String,
        enum: ["Active", "Archived", "Invited", "Rejected"],
        default: "Active"
    },
    last_login: { type: Date, default: new Date() },
    email_verified: { type: Boolean, default: false },
    has_organisation: { type: Boolean, default: false },
    has_password: { type: Boolean, default: false },
    phone_number: { type: String, default: null },
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

usersSchema.index({ name: "text", email: "text" });
usersSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model("User", usersSchema);
