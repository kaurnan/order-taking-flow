const mongoose = require('mongoose');

const RedirectLinkSchema = new mongoose.Schema({
    shortCode: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    targetUrl: {
        type: String,
        required: true,
    },
    template_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsAppTemplate',
        required: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('RedirectLink', RedirectLinkSchema, 'redirectlinks');
