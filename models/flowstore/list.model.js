const mongoose = require("mongoose");

const { Schema } = mongoose;

const FlowstoreListSchema = new Schema({
    thumbnail: {
        type: String,
        required: true,
    },
    thumbnail_desc: {
        type: String,
        required: true,
    },
    handle: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    isPaid: {
        type: Boolean,
        default: false,
    },
    price: {
        type: Number,
        default: 0,
    },
    downloads: {
        type: Number,
        default: 0,
    },
    rating: {
        type: Number,
        default: 0,
    },
    creator: {
        type: Schema.Types.ObjectId,
        ref: "flowcreator",
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    desc: {
        type: String,
        required: true,
    },
    rating_ref: {
        type: Schema.Types.ObjectId,
        ref: "flowrating",
    },
    category: "string",
    platform: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "FlowstorePlatform",
    },
    tags: [
        {
            type: Schema.Types.ObjectId,
            ref: "Tag",
        },
    ],
    additional_imgs: [
        {
            type: String,
        },
    ],
}, {
    timestamps: true,
});
const FlowstoreList = mongoose.model("FlowstoreList", FlowstoreListSchema);
module.exports = FlowstoreList;