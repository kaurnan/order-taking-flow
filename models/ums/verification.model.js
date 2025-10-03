const mongoose = require("mongoose");

const VerificationSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    phone_number: {
        type: String,
    },
    otp: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300, // OTP expires in 5 minutes
    },
});

module.exports = mongoose.model("account_verification", VerificationSchema);
