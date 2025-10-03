const mongoose = require("mongoose");

const { Schema } = mongoose;

const GetStartedSchema = new Schema({
    org_id: { type: Schema.Types.ObjectId, ref: "Organisations", required: true },
    account_created: { type: Boolean, default: true },
    channel_created: { type: Boolean, default: false },
    integration_completed: { type: Boolean, default: false },
    user_invited: { type: Boolean, default: false },
    paid_plan: { type: Boolean, default: false }
}, {
    timestamps: true // Adds createdAt and updatedAt timestamps
});

module.exports = mongoose.model("GetStarted", GetStartedSchema);