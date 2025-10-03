const mongoose = require('mongoose');

const BroadcastOverviewSchema = new mongoose.Schema(
    {
        org_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organisation',
            required: true,
            index: true,
        },
        branch_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Branch',
            required: true,
            index: true,
        },
        total_enqueued: {
            type: Number,
            default: 0,
        },
        total_failed: {
            type: Number,
            default: 0,
        },
        total_sent: {
            type: Number,
            default: 0,
        },
        total_delivered: {
            type: Number,
            default: 0,
        },
        total_read: {
            type: Number,
            default: 0,
        },
        total_clicked: {
            type: Number,
            default: 0,
        },
        total_replied: {
            type: Number,
            default: 0,
        },
        total_recipients: {
            type: Number,
            default: 0,
        }
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('BroadcastOverview', BroadcastOverviewSchema);
