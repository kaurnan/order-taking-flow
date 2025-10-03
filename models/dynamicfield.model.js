const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DynamicFieldSchema = new Schema({
    platform: {
        type: String,
        required: true,
        index: true
    },
    key: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    label: {
        type: String,
        required: true
    },
    branch_id: {
        type: Schema.Types.ObjectId,
        ref: 'Branch',
        required: true,
        index: true
    },
}, {
    timestamps: true,
});

DynamicFieldSchema.index({ platform: 1, branch_id: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('DynamicField', DynamicFieldSchema);
