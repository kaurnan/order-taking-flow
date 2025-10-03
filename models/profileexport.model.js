const mongoose = require("mongoose");

const ProfileExportSchema = new mongoose.Schema(
    {
        org_id: {
            type: mongoose.Types.ObjectId,
            required: true,
            ref: "organisations"
        },
        branch_id: {
            type: mongoose.Types.ObjectId,
            required: true,
            ref: "branches"
        },
        title: {
            type: String,
            required: true
        },
        query: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        },
        export_type: {
            type: String,
            enum: ["csv", "json", "xlsx"],
            default: "csv"
        },
        fields: {
            type: [String],
            required: true
        },
        status: {
            type: String,
            enum: ["pending", "processing", "completed", "failed", "cancelled"],
            default: "pending"
        },
        customer_count: {
            type: Number,
            required: true
        },
        processed_count: {
            type: Number,
            default: 0
        },
        include_tags: {
            type: Boolean,
            default: true
        },
        include_lists: {
            type: Boolean,
            default: true
        },
        include_metadata: {
            type: Boolean,
            default: true
        },
        file_url: {
            type: String
        },
        file_size: {
            type: Number
        },
        error_message: {
            type: String
        },
        progress_percentage: {
            type: Number,
            default: 0
        },
        created_by: {
            type: mongoose.Types.ObjectId,
            ref: "users"
        },
        started_at: {
            type: Date
        },
        completed_at: {
            type: Date
        }
    },
    { timestamps: true }
);

// Indexes for better query performance
ProfileExportSchema.index({ org_id: 1, branch_id: 1, status: 1 });
ProfileExportSchema.index({ org_id: 1, branch_id: 1, created_at: -1 });
ProfileExportSchema.index({ status: 1, created_at: 1 });
ProfileExportSchema.index({ created_by: 1 });

// Virtual for export duration
ProfileExportSchema.virtual('duration').get(function () {
    if (this.started_at && this.completed_at) {
        return this.completed_at - this.started_at;
    }
    return null;
});

// Method to update progress
ProfileExportSchema.methods.updateProgress = function (processedCount) {
    this.processed_count = processedCount;
    this.progress_percentage = Math.round((processedCount / this.customer_count) * 100);
    return this.save();
};

// Method to mark as started
ProfileExportSchema.methods.markAsStarted = function () {
    this.status = "processing";
    this.started_at = new Date();
    return this.save();
};

// Method to mark as completed
ProfileExportSchema.methods.markAsCompleted = function (fileUrl, fileSize) {
    this.status = "completed";
    this.file_url = fileUrl;
    this.file_size = fileSize;
    this.completed_at = new Date();
    this.progress_percentage = 100;
    this.processed_count = this.customer_count;
    return this.save();
};

// Method to mark as failed
ProfileExportSchema.methods.markAsFailed = function (errorMessage) {
    this.status = "failed";
    this.error_message = errorMessage;
    this.completed_at = new Date();
    return this.save();
};

// Transform to JSON
ProfileExportSchema.set("toJSON", {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    },
    virtuals: true
});

module.exports = mongoose.model("ProfileExport", ProfileExportSchema); 