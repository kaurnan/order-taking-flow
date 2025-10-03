const mongoose = require("mongoose");

const FlowstorePlatformSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    desc: {
        type: String,
        trim: true,
    },
}, { timestamps: true });



FlowstorePlatformSchema.pre("save", function (next) {
    this.updatedAt = Date.now();
    next();
});

const FlowstorePlatform = mongoose.model("FlowstorePlatform", FlowstorePlatformSchema);

module.exports = FlowstorePlatform;