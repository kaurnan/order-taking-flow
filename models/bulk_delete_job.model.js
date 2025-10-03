const mongoose = require('mongoose');
const { Schema } = mongoose;

const bulkDeleteJobSchema = new Schema({
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    org_id: {
        type: Schema.Types.ObjectId,
        ref: 'organisations',
        required: true,
        index: true
    },
    templateIds: [{
        type: String,
        required: true
    }],
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
        default: 'pending',
        index: true
    },
    progress: {
        total: {
            type: Number,
            default: 0
        },
        completed: {
            type: Number,
            default: 0
        },
        failed: {
            type: Number,
            default: 0
        },
        successful: {
            type: Number,
            default: 0
        }
    },
    results: [{
        templateId: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: ['pending', 'success', 'failed', 'permanently_failed'],
            default: 'pending'
        },
        message: String,
        error: String,
        completedAt: Date
    }],
    startedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date
    },
    error: {
        message: String,
        code: String
    },
    metadata: {
        initiatedBy: {
            type: String,
            required: true
        },
        userAgent: String,
        ipAddress: String
    }
}, {
    timestamps: true
});

// Index for efficient querying
bulkDeleteJobSchema.index({ org_id: 1, status: 1, createdAt: -1 });

// Method to update progress
bulkDeleteJobSchema.methods.updateProgress = function () {
    const completed = this.results.filter(r => r.status === 'success').length;
    const failed = this.results.filter(r => r.status === 'failed' || r.status === 'permanently_failed').length;

    this.progress.completed = completed + failed;
    this.progress.successful = completed;
    this.progress.failed = failed;

    // Update overall status
    if (this.progress.completed === this.progress.total) {
        this.status = this.progress.failed === 0 ? 'completed' : 'failed';
        this.completedAt = new Date();
    } else if (this.progress.completed > 0) {
        this.status = 'processing';
    }

    return this.save();
};

// Method to update template result
bulkDeleteJobSchema.methods.updateTemplateResult = function (templateId, status, message, error) {
    const result = this.results.find(r => r.templateId === templateId);
    if (result) {
        result.status = status;
        result.message = message;
        result.error = error;
        result.completedAt = new Date();
    }

    return this.updateProgress();
};

module.exports = mongoose.model('BulkDeleteJob', bulkDeleteJobSchema); 