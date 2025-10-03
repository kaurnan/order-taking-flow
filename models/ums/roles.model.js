const mongoose = require("mongoose");

const RolesSchema = new mongoose.Schema({
    name: { type: String },
    desc: { type: String },
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: "Organisation" },
    scopes: { type: [mongoose.Types.ObjectId], ref: "Scopes" },
    deletable: { type: Boolean },
}, {
    timestamps: true
});

RolesSchema.index({ name: 1, org_id: 1 }, { unique: true });
RolesSchema.index({ scopes: 1 }, { unique: false });
RolesSchema.index({ desc: 1 }, { unique: false });

module.exports = mongoose.model("Role", RolesSchema);
