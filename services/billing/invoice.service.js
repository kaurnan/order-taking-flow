const DbService = require("../../mixins/db.mixin");
const Invoice = require("../../models/invoice.model");
const invoiceQueue = require("../../queues/invoice.queue");

module.exports = {
    name: "invoice",
    mixins: [DbService("invoice")],

    settings: {
        fields: [
            "_id",
            "org_id",
            "invoiceDate",
            "amount",
            "status",
            "invoiceNumber",
            "dueDate",
            "file", // Added file field
            "createdAt",
            "updatedAt",
        ],
        populates: {
            org_id: {
                action: "ums_organisation.get",
                params: {
                    fields: ["_id", "name"],
                },
            },
        },
    },

    actions: {
        /**
         * Get a list of invoices with pagination and filtering.
         *
         * @actions
         * @param {Object} ctx - Context object.
         * @param {Number} ctx.params.page - Page number (default: 1).
         * @param {Number} ctx.params.pageSize - Number of items per page (default: 10).
         * @param {String} ctx.params.search - Search query for invoice number.
         * @param {String} ctx.params.month - Month for filtering (YYYY-MM format).
         * @param {String} ctx.params.status - Filter by invoice status.
         * @returns {Object} - Paginated list of invoices.
         */
        listInvoices: {
            rest: "GET /invoices",
            params: {
                page: { type: "number", optional: true, convert: true, default: 1 },
                pageSize: { type: "number", optional: true, convert: true, default: 10 },
                search: { type: "string", optional: true },
                month: { type: "string", optional: true }, // YYYY-MM
                status: { type: "string", optional: true, enum: ["pending", "paid", "cancelled"] },
            },
            async handler(ctx) {
                const { page, pageSize, search, month, status } = ctx.params;
                const query = { org_id: ctx.meta.org_id }; // Assuming org_id is available in meta

                if (search) {
                    query.invoiceNumber = { $regex: search, $options: "i" };
                }

                if (month) {
                    const [year, mon] = month.split("-");
                    const startDate = new Date(year, parseInt(mon) - 1, 1);
                    const endDate = new Date(year, parseInt(mon), 0); // Last day of the month
                    query.invoiceDate = { $gte: startDate, $lte: endDate };
                }

                if (status) {
                    query.status = status;
                }

                const count = await this.adapter.model.countDocuments(query);
                const rows = await this.adapter.model.find(query)
                    .skip((page - 1) * pageSize)
                    .limit(pageSize)
                    .sort({ invoiceDate: -1 }) // Sort by most recent invoices first
                    .lean();

                return {
                    total: count,
                    page,
                    pageSize,
                    totalPages: Math.ceil(count / pageSize),
                    data: rows,
                };
            },
        },

        /**
         * Get a single invoice by ID.
         *
         * @actions
         * @param {Object} ctx - Context object.
         * @param {String} ctx.params.id - Invoice ID.
         * @returns {Object} - Invoice data.
         */
        get: {
            rest: "GET /invoices/:id",
            params: {
                id: "string",
            },
            async handler(ctx) {
                const invoice = await Invoice.findOne({ _id: ctx.params.id, org_id: ctx.meta.user.org_id }).lean();
                if (!invoice) {
                    throw new Error("Invoice not found.");
                }
                return invoice;
            },
        },

        /**
         * Download an invoice (placeholder).
         *
         * @actions
         * @param {Object} ctx - Context object.
         * @param {String} ctx.params.id - Invoice ID.
         */
        download: {
            rest: "GET /invoices/:id/download",
            params: {
                id: "string",
            },
            async handler(ctx) {
                // In a real application, this would generate and return a PDF or other file.
                // For now, it's a placeholder.
                this.logger.info(`Download request for invoice ID: ${ctx.params.id}`);
                return { message: `Download initiated for invoice ID: ${ctx.params.id}` };
            },
        },

        /**
         * Enqueue a job to download multiple invoices or all invoices.
         *
         * @actions
         * @param {Object} ctx - Context object.
         * @param {Array<String>} [ctx.params.invoiceIds] - Array of invoice IDs to download.
         * @param {Boolean} [ctx.params.selectAll] - If true, download all invoices for the organization.
         * @returns {Object} - Job status.
         */
        downloadAllInvoices: {
            rest: "POST /invoices/download/all",
            params: {
                invoiceIds: { type: "array", items: "string", optional: true },
                selectAll: { type: "boolean", optional: true, default: false },
            },
            async handler(ctx) {
                const { invoiceIds, selectAll } = ctx.params;
                const orgId = ctx.meta.org_id; // Assuming org_id is available in meta

                if (!invoiceIds && !selectAll) {
                    throw new Error("Either 'invoiceIds' or 'selectAll' must be provided.");
                }

                if (invoiceIds && invoiceIds.length === 0) {
                    throw new Error("'invoiceIds' cannot be an empty array.");
                }

                const jobData = {
                    type: "downloadAllInvoices",
                    orgId,
                    invoiceIds,
                    selectAll,
                    userId: ctx.meta.user._id, // Assuming user ID is available for notification
                };

                await invoiceQueue.add("downloadAllInvoices", jobData);

                return { message: "Invoice download job enqueued successfully.", success: true };
            },
        },
    },
};
