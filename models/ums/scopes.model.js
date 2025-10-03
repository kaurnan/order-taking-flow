const mongoose = require("mongoose");

const scopesSchema = new mongoose.Schema({
    name: { type: String },
    desc: { type: String },
    access: { type: String },
});

module.exports = mongoose.model("Scopes", scopesSchema);