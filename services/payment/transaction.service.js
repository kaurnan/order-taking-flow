const DbMixin = require("../../mixins/db.mixin");
const mongoose = require("mongoose");

"use strict";

module.exports = {
    name: "transaction",
    mixins: [DbMixin("transaction")],

    settings: {
        fields: ["_id", "amount", "type", "status", "org_id", "userId", "payment_gateway", "gateway_transaction_id", "merchant_order_id", "description", "currency", "createdAt", "updatedAt"],

        entityValidator: {
            amount: { type: "number", positive: true, convert: true },
            type: { type: "enum", values: ["credit", "debit", "payment", "refund"] },
            status: { type: "enum", values: ["pending", "completed", "failed", "cancelled"] },
            org_id: { type: "string", optional: false },
            userId: { type: "string", optional: false },
            payment_gateway: { type: "enum", values: ["phonepe", "razorpay", "stripe", "other"], optional: true },
            currency: { type: "string", optional: true, default: "INR" }
        },
    },

    actions: {
        create: {
            rest: "POST /",
            params: {
                amount: "number",
                type: { type: "enum", values: ["credit", "debit", "payment", "refund"] },
                status: { type: "enum", values: ["pending", "completed", "failed", "cancelled"], optional: true, default: "pending" },
                org_id: "string",
                userId: "string",
                description: { type: "string", optional: true },
                payment_gateway: { type: "enum", values: ["phonepe", "razorpay", "stripe", "other"], optional: true },
                gateway_transaction_id: { type: "string", optional: true },
                merchant_order_id: { type: "string", optional: true },
                currency: { type: "string", optional: true, default: "INR" },
                recharge_type: { type: "enum", values: ["wallet_recharge", "subscription", "one_time"], optional: true },
                metadata: { type: "object", optional: true }
            },
            async handler(ctx) {
                const entity = ctx.params;
                entity.createdAt = new Date();
                entity.updatedAt = new Date();
                entity.org_id = new mongoose.Types.ObjectId(entity.org_id);
                entity.userId = new mongoose.Types.ObjectId(entity.userId);

                return await this.adapter.insert(entity);
            },
        },

        get: {
            rest: "GET /:id",
            params: {
                id: "string",
            },
            async handler(ctx) {
                return await this.adapter.findById(ctx.params.id);
            },
        },

        update: {
            rest: "PUT /:id",
            params: {
                id: "string",
                amount: { type: "number", optional: true },
                type: { type: "enum", values: ["credit", "debit", "payment", "refund"], optional: true },
                status: { type: "enum", values: ["pending", "completed", "failed", "cancelled"], optional: true },
                description: { type: "string", optional: true },
                gateway_response: { type: "object", optional: true },
                metadata: { type: "object", optional: true }
            },
            async handler(ctx) {
                const update = ctx.params;
                update.updatedAt = new Date();
                return await this.adapter.updateById(ctx.params.id, { $set: update });
            },
        },

        remove: {
            rest: "DELETE /:id",
            params: {
                id: "string",
            },
            async handler(ctx) {
                return await this.adapter.removeById(ctx.params.id);
            },
        },

        /**
         * Get transactions for an organisation
         */
        getOrgTransactions: {
            auth: "required",
            rest: "GET /org/:org_id",
            params: {
                page: { type: "string", optional: true, default: 1 },
                limit: { type: "string", optional: true, default: 10 },
                type: { type: "string", optional: true },
                status: { type: "string", optional: true },
                payment_gateway: { type: "string", optional: true },
                startDate: { type: "string", optional: true },
                endDate: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { page, limit, type, status, payment_gateway, startDate, endDate } = ctx.params;
                const { org_id } = ctx.meta;

                const query = {
                    org_id: new mongoose.Types.ObjectId(org_id)
                };



                if (type) query.type = type;
                if (status) query.status = status;
                if (payment_gateway) query.payment_gateway = payment_gateway;

                // Date range filter
                if (startDate || endDate) {
                    query.createdAt = {};
                    if (startDate) query.createdAt.$gte = new Date(startDate);
                    if (endDate) query.createdAt.$lte = new Date(endDate);
                }

                const skip = (page - 1) * limit;

                const transactions = await this.adapter.find({
                    query,
                    sort: { createdAt: -1 },
                    limit,
                    offset: skip
                })
                const total = await this.adapter.model.countDocuments(query);

                return {
                    success: true,
                    data: {
                        transactions,
                        pagination: {
                            page: parseInt(page),
                            limit: parseInt(limit),
                            total,
                            pages: Math.ceil(total / limit)
                        }
                    }
                };
            }
        },

        /**
         * Get user transactions
         */
        getUserTransactions: {
            auth: "required",
            rest: "GET /user/:userId",
            params: {
                page: { type: "number", optional: true, default: 1 },
                limit: { type: "number", optional: true, default: 10 },
                type: { type: "string", optional: true },
                status: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { page, limit, type, status } = ctx.params;
                const { userId } = ctx.params;

                const query = {
                    userId: new mongoose.Types.ObjectId(userId)
                };

                if (type) query.type = type;
                if (status) query.status = status;

                const skip = (page - 1) * limit;

                const transactions = await this.adapter.find({
                    query,
                    sort: { createdAt: -1 },
                    limit,
                    offset: skip
                });

                const total = await this.adapter.count(query);

                return {
                    success: true,
                    data: {
                        transactions,
                        pagination: {
                            page,
                            limit,
                            total,
                            pages: Math.ceil(total / limit)
                        }
                    }
                };
            }
        },

        /**
         * Get transaction statistics for an organisation
         */
        getTransactionStats: {
            auth: "required",
            rest: "GET /stats/:org_id",
            params: {
                startDate: { type: "string", optional: true },
                endDate: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { startDate, endDate } = ctx.params;
                const { org_id } = ctx.meta;

                const query = {
                    org_id: new mongoose.Types.ObjectId(org_id)
                };

                if (startDate || endDate) {
                    query.createdAt = {};
                    if (startDate) query.createdAt.$gte = new Date(startDate);
                    if (endDate) query.createdAt.$lte = new Date(endDate);
                }

                // Get all transactions for the period
                const transactions = await this.adapter.find({ query });

                // Calculate statistics
                const stats = {
                    total_transactions: transactions.length,
                    total_amount: 0,
                    successful_payments: 0,
                    failed_payments: 0,
                    pending_payments: 0,
                    total_credits: 0,
                    total_debits: 0,
                    total_refunds: 0,
                    by_gateway: {},
                    by_status: {},
                    by_type: {}
                };

                transactions.forEach(tx => {
                    stats.total_amount += tx.amount;

                    // Count by type
                    stats[`total_${tx.type}s`] = (stats[`total_${tx.type}s`] || 0) + 1;
                    stats.by_type[tx.type] = (stats.by_type[tx.type] || 0) + 1;

                    // Count by status
                    stats.by_status[tx.status] = (stats.by_status[tx.status] || 0) + 1;

                    // Count payment statuses
                    if (tx.type === "payment") {
                        if (tx.status === "completed") stats.successful_payments++;
                        else if (tx.status === "failed") stats.failed_payments++;
                        else if (tx.status === "pending") stats.pending_payments++;
                    }

                    // Count by gateway
                    if (tx.payment_gateway) {
                        stats.by_gateway[tx.payment_gateway] = (stats.by_gateway[tx.payment_gateway] || 0) + 1;
                    }
                });

                return {
                    success: true,
                    data: stats
                };
            }
        },

        /**
         * Search transactions
         */
        searchTransactions: {
            auth: "required",
            rest: "GET /search",
            params: {
                query: { type: "string", optional: true },
                page: { type: "number", optional: true, default: 1 },
                limit: { type: "number", optional: true, default: 10 }
            },
            async handler(ctx) {
                const { query, page, limit } = ctx.params;
                const { org_id } = ctx.meta;

                const searchQuery = {
                    org_id: new mongoose.Types.ObjectId(org_id)
                };

                if (query) {
                    searchQuery.$or = [
                        { description: { $regex: query, $options: "i" } },
                        { merchant_order_id: { $regex: query, $options: "i" } },
                        { gateway_transaction_id: { $regex: query, $options: "i" } }
                    ];
                }

                const skip = (page - 1) * limit;

                const transactions = await this.adapter.find({
                    query: searchQuery,
                    sort: { createdAt: -1 },
                    limit,
                    offset: skip
                });

                const total = await this.adapter.count(searchQuery);

                return {
                    success: true,
                    data: {
                        transactions,
                        pagination: {
                            page,
                            limit,
                            total,
                            pages: Math.ceil(total / limit)
                        }
                    }
                };
            }
        }
    },

    methods: {
        /**
         * Create a transaction record
         */
        async createTransaction(data) {
            return await this.adapter.insert({
                ...data,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        },

        /**
         * Update transaction status
         */
        async updateTransactionStatus(transactionId, status, additionalData = {}) {
            return await this.adapter.updateById(transactionId, {
                $set: {
                    status,
                    updatedAt: new Date(),
                    ...additionalData
                }
            });
        }
    },

    created() { },

    started() { },

    stopped() { },
};