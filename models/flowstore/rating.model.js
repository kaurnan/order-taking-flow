const mongoose = require("mongoose");

const FlowstoreRatingSchema = new mongoose.Schema({
    customer_name: {
        type: String,
        required: true,
        trim: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    text_review: {
        type: String,
        trim: true
    },
    photo_review: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("FlowstoreRating", FlowstoreRatingSchema);