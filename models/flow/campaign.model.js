const mongoose = require("mongoose");

const CampaignSchema = new mongoose.Schema({
    branch_id: { type: mongoose.Schema.Types.ObjectId, ref: "branches", required: true },
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: "organizations", required: true },
    title: { type: String, required: true },
    status: { type: String, default: "Draft" },
    start_date: { type: Date, required: true },
    end_date: { type: Date },
    description: { type: String },
    flow_ref: { type: mongoose.Schema.Types.ObjectId, ref: "flows" },
    flows: { type: [mongoose.SchemaTypes.Mixed], required: true },
    total_enqueued: { type: Number, default: 0 },
    total_sent: { type: Number, default: 0 },
    total_delivered: { type: Number, default: 0 },
    total_opened: { type: Number, default: 0 },
    total_failed: { type: Number, default: 0 },
    total_read: { type: Number, default: 0 },
    total_replied: { type: Number, default: 0 },
    flow_versions: [{
        id: { type: mongoose.Schema.Types.ObjectId },
        version: { type: Number },
    }]
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function (doc, ret) {
            delete ret.__v;
            return ret;
        }
    },
    toObject: {
        virtuals: true,
        transform: function (doc, ret) {
            delete ret.__v;
            return ret;
        }
    }
});

CampaignSchema.virtual("duration").get(function () {
    if (this.start_date && this.end_date) {
        return (this.end_date - this.start_date) / (1000 * 60 * 60 * 24); // days
    }
    return null;
});

CampaignSchema.index({ title: "text", description: "text" });
CampaignSchema.index({ flow_ref: 1, branch_id: 1 });

module.exports = mongoose.model("campaign", CampaignSchema);