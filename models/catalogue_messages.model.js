"use strict";

const { ObjectId } = require("mongodb");

/**
 * Catalogue Messages Model
 * 
 * This model stores logs of catalogue messages sent to customers
 */

const catalogueMessagesSchema = {
    _id: ObjectId,
    customerId: String,
    catalogueId: String,
    messageType: String, // "interactive" or "template"
    message: String,
    templateName: String,
    templateLanguage: String,
    templateData: Object,
    thumbnailProductId: String,
    workflowId: String,
    status: String, // "sent", "failed", "pending"
    messageId: String,
    phone: String,
    orgId: ObjectId,
    branchId: ObjectId,
    createdAt: Date,
    updatedAt: Date
};

module.exports = catalogueMessagesSchema;
