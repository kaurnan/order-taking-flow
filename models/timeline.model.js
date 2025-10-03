const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TimelineSchema = new Schema({
    org_id: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    event_type: {
        type: String,
        required: true,
        default: 'system'
    },
    reference: {
        type: Schema.Types.ObjectId,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    details: {
        type: String,
        required: false // Assuming details can be optional
    },
    status: {
        type: String,
        required: false // Assuming status can be optional, or have a default
    }
}, {
    timestamps: true // Automatically manage createdAt and updatedAt fields
});

module.exports = mongoose.model('Timeline', TimelineSchema);
