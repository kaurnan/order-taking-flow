const mongoose = require("mongoose");

const CreatorSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
    },
    user_id: {
        type: String,
        required: true,
        unique: true,
    },
    profile_pic: {
        type: String,
        default: "",
    },
    desc: {
        type: String,
        default: "",
    },
    flows_imported: {
        type: Number,
        default: 0,
    },
    overall_rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
    },
    uid: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model("FlowstoreCreator", CreatorSchema);