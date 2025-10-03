const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        desc: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt fields
    }
);

const Category = mongoose.model("flowstoreCategory", CategorySchema);

module.exports = Category;