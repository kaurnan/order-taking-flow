const mongoose = require("mongoose");

const userInviteSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, index: true },
        role: { type: String, required: true },
        org_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Organisation" },
        expireAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000), index: { expires: 0 } },
        status: {
            type: String,
            default: "Pending",
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("UserInvite", userInviteSchema);