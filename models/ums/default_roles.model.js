const mongoose = require("mongoose");

const DefaultRolesSchema = new mongoose.Schema({
    name: { type: String, unique: true },
    descriptions: { type: String },
    scopes: { type: [String] },
});

module.exports = mongoose.model("DefaultRoles", DefaultRolesSchema);

