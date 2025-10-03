const mongoose = require("mongoose");

const PasswordResetSchema = new mongoose.Schema({
    email: { type: String, default: null },
    tokenHash: { type: String, required: true },       // bcrypt hash of the token
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 1800 } },
    used: { type: Boolean, default: false },
});

// Create a compound index on email and app_id
PasswordResetSchema.index({ email: 1 });

module.exports = mongoose.model("PasswordReset", PasswordResetSchema);