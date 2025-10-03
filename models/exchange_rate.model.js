const mongoose = require("mongoose");

const ExchangeRateSchema = new mongoose.Schema({
    currencyPair: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    rate: {
        type: Number,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("ExchangeRate", ExchangeRateSchema);
