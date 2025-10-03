const mongoose = require("mongoose");

const userOrganisationSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: "User"
    },
    org_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: "Organisation"
    },
    role: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: "Role"
    },
    status: {
        type: String,
        enum: ["Active", "Invited", "Rejected", "Archived"],
        default: "Active"
    },
    name: {
        type: String,
        default: null,
        index: true // Index for faster lookups
    },
    email: {
        type: String,
        default: null,
        index: true // Index for faster lookups
    },
    plan: {
        ref: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Pricing"
        }
    }
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Add indexes for archive functionality
userOrganisationSchema.index({ user_id: 1, org_id: 1 }, { unique: true });
userOrganisationSchema.index({ org_id: 1, status: 1 });
userOrganisationSchema.index({ user_id: 1, status: 1 });
userOrganisationSchema.index({ status: 1, updated_at: 1 });

module.exports = mongoose.model("UserOrganisation", userOrganisationSchema);