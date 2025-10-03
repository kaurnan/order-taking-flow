"use strict";

const dbMixin = require("../../mixins/db.mixin");
const { CreateAggregation, FormatPhoneNumber, formatImportHistoryTitle } = require("../../utils/common");
const { ObjectId } = require("mongodb");
const { MoleculerError } = require("moleculer").Errors;
const customerImportQueue = require("../../queues/customer-import.queue");
const customerimportModel = require("../../models/customerimport.model");
const listModel = require("../../models/list.model");
const segmentModel = require("../../models/segment.model");
const tagModel = require("../../models/tag.model");
const CustomerColumnOrderModel = require("../../models/customer_column_order.model");


module.exports = {
    name: "customer",
    mixins: [dbMixin("customer")],
    actions: {
        /**
         * Fetch customer details by ID
         * @param {string} id - Customer ID
         */
        getSingleAudience: {
            rest: {
                method: "GET",
                path: "/audience"
            },
            params: {
                id: "string"
            },
            async handler(ctx) {
                try {
                    const { id } = ctx.params;
                    if (this.isUserAllowedToView(ctx)) {
                        let doc = await this.adapter.model.findOne({ _id: new ObjectId(id) }).populate({
                            path: "lists",
                            model: listModel,
                            select: "title"
                        }).populate({
                            path: "tags",
                            model: tagModel,
                            select: "name"
                        });
                        return {
                            code: "200",
                            success: true,
                            message: "Customer details fetched successfully",
                            data: doc,
                        };
                    }
                    else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    throw new MoleculerError("Failed to fetch customer", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            }
        },

        /**
         * Get the count of customers based on query parameters
         * @param {object} query - Query parameters to filter customers
         * This action used internally not exposed via REST API
         */
        Getcount: {
            params: {
                query: { type: "object", optional: true }
            },
            async handler(ctx) {
                const { query } = ctx.params;
                let count = 0;
                count = await this.adapter.model.countDocuments({ ...query });
                return count;
            }
        },

        /**
         * Fetch audience details with pagination and filtering
         * @param {string} page - Page number for pagination
         * @param {string} pageSize - Number of records per page
         * @param {string} filter - Filter criteria in JSON format
         * @param {string} search - Search term to filter customers
         * @returns {object} - Returns an object containing customer records and pagination info
         */
        getAudience: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/audience",
            },
            params: {
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                filter: { type: "string", optional: true },
                search: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { pageSize, page, search } = ctx.params;
                const filter = ctx.params.filter ? JSON.parse(ctx.params.filter) : null;
                const org_id = new ObjectId(ctx.meta.org_id);
                const branch_id = new ObjectId(ctx.meta.branch_id);

                if (this.isUserAllowedToView(ctx)) {
                    const aggregationQuery = CreateAggregation(org_id, branch_id, search, null, null, filter, null, null, false, true);
                    if (aggregationQuery[0]?.$match?.lists?.$in) {
                        aggregationQuery[0].$match.lists.$in = aggregationQuery[0].$match.lists.$in.map(id => new ObjectId(id));
                    }

                    const updateIdsInCondition = (condition) => {
                        if (condition?.lists?.$in) {
                            condition.lists.$in = condition.lists.$in.map(id => {
                                if (Array.isArray(id)) {
                                    return id.map(innerId => new ObjectId(innerId));
                                }
                                return new ObjectId(id);
                            });
                        }
                        return condition;
                    };

                    const traverseAndUpdate = (query) => {
                        if (query?.$and) {
                            query.$and = query.$and.map(traverseAndUpdate);
                        } else if (query?.$or) {
                            query.$or = query.$or.map(traverseAndUpdate);
                        } else {
                            query = updateIdsInCondition(query);
                        }
                        return query;
                    };

                    aggregationQuery[0].$match = traverseAndUpdate(aggregationQuery[0].$match);
                    const skipValue = (parseInt(page) - 1) * parseInt(pageSize);

                    // Single pipeline with $facet to avoid double scanning (data + total)
                    const facetPipeline = [
                        ...aggregationQuery,
                        {
                            $facet: {
                                data: [
                                    { $skip: skipValue },
                                    { $limit: parseInt(pageSize) },
                                    {
                                        $lookup: {
                                            from: "tags",
                                            localField: "tags",
                                            foreignField: "_id",
                                            as: "tags",
                                        },
                                    },
                                ],
                                totalCount: [
                                    { $count: "total" }
                                ]
                            }
                        }
                    ];

                    const facetResultArr = await this.adapter.model.aggregate(facetPipeline);
                    const facetResult = Array.isArray(facetResultArr) && facetResultArr.length > 0 ? facetResultArr[0] : { data: [], totalCount: [] };
                    const total = (facetResult.totalCount[0]?.total) || 0;
                    const records = facetResult.data || [];

                    const pageInfo = {
                        total: total,
                        page: parseInt(page),
                        pageSize: parseInt(pageSize),
                        totalPages: Math.ceil(total / parseInt(pageSize)),
                    };

                    return {
                        code: "200",
                        success: true,
                        message: "Customers fetched successfully",
                        data: records,
                        pagination: pageInfo,
                    };
                } else {
                    throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                }
            }
        },

        /**
         * Add a new audience/customer
         * @param {string} phone - Customer's phone number
         * @param {string} name - Customer's name
         * @param {string} email - Customer's email (optional)
         * @param {string} state - Customer's state (optional)
         * @param {string} note - Additional notes about the customer (optional)
         * @param {array} tags - Tags associated with the customer (optional)
         * @param {array} addresses - Addresses associated with the customer (optional)
         * @param {boolean} email_marketing_consent - Consent for email marketing (optional)
         * @param {boolean} sms_marketing_consent - Consent for SMS marketing (optional
         * @param {boolean} whatsapp_marketing_consent - Consent for WhatsApp marketing (optional)
         * @param {string} country - Customer's country (optional)
         * @param {number} revenu - Customer's revenue (optional)
         * @returns {object} - Returns an object containing the created customer data
         */
        addAudience: {
            rest: {
                method: "POST",
                path: "/audience",
            },
            auth: "required",
            params: {
                phone: "string",
                name: {
                    type: "string",
                    min: 1,
                    max: 30,
                    pattern: "^[a-zA-Z\\s'-]+$",
                    messages: {
                        stringPattern: "Name can only contain letters, spaces, apostrophes, and hyphens.",
                        stringMin: "Name cannot be empty."
                    }
                },
                email: { type: "email", optional: true },
                state: { type: "string", optional: true },
                note: { type: "string", optional: true },
                tags: { type: "array", items: "string", optional: true },
                addresses: { type: "array", items: "string", optional: true },
                email_marketing_consent: { type: "boolean", optional: true },
                sms_marketing_consent: { type: "boolean", optional: true },
                whatsapp_marketing_consent: { type: "boolean", optional: true },
                country: { type: "string", optional: true },
                lists: { type: "array", items: "string", optional: true }
            },
            async handler(ctx) {
                const { phone, name, email, state, note, tags, addresses, email_marketing_consent, sms_marketing_consent, whatsapp_marketing_consent, country, lists } = ctx.params;
                const timestamp = Date.now();
                const branch_id = ctx.meta.branch_id;
                const org_id = ctx.meta.org_id;

                try {
                    if (this.isUserAllowedToEdit(ctx)) {
                        const customer = {
                            name: name ?? `unknown${timestamp}`,
                            email: email,
                            state: state ?? "",
                            note: note ?? "",
                            tags: tags ?? [],
                            phone,
                            lists: lists ? lists.map(id => new ObjectId(id)) : [],
                            country: country ?? "",
                            addresses,
                            email_marketing_consent: email_marketing_consent == null ? false : email_marketing_consent,
                            sms_marketing_consent: sms_marketing_consent == null ? false : sms_marketing_consent,
                            whatsapp_marketing_consent: whatsapp_marketing_consent == null ? false : whatsapp_marketing_consent,
                            org_id: org_id,
                            branch_id,
                            verified_email: false,
                            reference: timestamp?.toString(),
                        };

                        const insertedDoc = await this.adapter.insert(customer);


                        return {
                            code: "200",
                            success: true,
                            message: "Customer created successfully",
                            data: insertedDoc,
                        };
                    } else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                } catch (err) {
                    if (err?.code === 11000) {
                        // Customer already exists, check if lists are provided
                        if (lists && lists.length > 0) {
                            try {
                                // Find the existing customer
                                const existingCustomer = await this.adapter.findOne({ phone, org_id, branch_id });

                                // Check if customer is already in any of the provided lists
                                const existingLists = existingCustomer.lists || [];
                                const listsToAdd = lists.map(id => new ObjectId(id));
                                
                                // Find lists that customer is not already in
                                const newLists = listsToAdd.filter(listId => 
                                    !existingLists.some(existingListId => existingListId.toString() === listId.toString())
                                );

                                if (newLists.length === 0) {
                                    // Customer is already in all provided lists
                                    return {
                                        code: "200",
                                        success: true,
                                        message: "Customer already exists in all provided lists",
                                        data: existingCustomer,
                                        alreadyInLists: true
                                    };
                                } else {
                                    // Add customer to new lists
                                    const updatedCustomer = await this.adapter.updateById(existingCustomer._id, {
                                        $addToSet: { lists: { $each: newLists } },
                                        $set: { updatedAt: new Date() }
                                    });

                                    return {
                                        code: "200",
                                        success: true,
                                        message: "Customer added to new lists successfully",
                                        data: updatedCustomer,
                                        addedToLists: true
                                    };
                                }
                            } catch (listError) {
                                console.error("Error handling existing customer lists:", listError);                                       
                                return {
                                    code: "400",
                                    success: false,
                                    message: "Customer creation failed! Customer already exists",
                                    data: null
                                };
                            }
                        } else {
                            // No lists provided, customer already exists
                            return {
                                code: "400",
                                success: false,
                                message: "Customer creation failed! Customer already exists",
                                data: null
                            };
                        }
                    } else if (err?.name === "ValidationError") {
                        throw new MoleculerError("Customer creation failed! Validation error", 400, "BAD_REQUEST");
                    } else {
                        console.error("Error in addAudience action:", err);
                        throw new MoleculerError("Customer creation failed! Internal server error", 500, "INTERNAL_SERVER_ERROR");
                    }
                }
            },
        },

        /**
         * Update an existing customer by ID
         * @param {string} id - Customer ID to update
         * @param {string} phone - Customer's phone number (optional)
         * @param {string} name - Customer's name (optional)
         * @param {string} email - Customer's email (optional)
         * @param {string} state - Customer's state (optional)
         * @param {array} tags - Tags associated with the customer (optional)
         * @param {array} addresses - Addresses associated with the customer (optional)
         * @param {boolean} email_marketing_consent - Consent for email marketing (optional)
         * @param {boolean} sms_marketing_consent - Consent for SMS marketing (optional
         * @param {boolean} whatsapp_marketing_consent - Consent for WhatsApp marketing (optional)
         * @param {string} country - Customer's country (optional)
         */
        updateAudience: {
            rest: {
                method: "PUT",
                path: "/update-audience"
            },
            auth: "required",
            params: {
                id: "string",
                phone: { type: "string", optional: true },
                name: { type: "string", optional: true },
                email: { type: "email", optional: true },
                state: { type: "string", optional: true },
                tags: { type: "array", items: "string", optional: true },
                addresses: { type: "array", items: "string", optional: true },
                email_marketing_consent: { type: "boolean", optional: true },
                sms_marketing_consent: { type: "boolean", optional: true },
                whatsapp_marketing_consent: { type: "boolean", optional: true },
                country: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { id, phone, name, email, state, tags, addresses, email_marketing_consent, sms_marketing_consent, whatsapp_marketing_consent, country } = ctx.params;
                const branch_id = ctx.meta.branch_id;
                const org_id = ctx.meta.org_id;

                try {
                    if (this.isUserAllowedToEdit(ctx)) {
                        let update = {};
                        if (email && email !== "") {
                            const existingEmail = await this.adapter.model.findOne({ email, _id: { $ne: id }, org_id, branch_id });
                            if (existingEmail) {
                                return {
                                    code: "400",
                                    success: false,
                                    message: "Email is already used by another customer",
                                    data: null,
                                };
                            }
                            update.email = email;
                        } else {
                            update.$unset = { ...(update.$unset || {}), email: "" };
                            update.email_marketing_consent = false;
                        }

                        if (phone) {
                            const existingPhone = await this.adapter.model.findOne({ phone, _id: { $ne: id }, org_id, branch_id, deleted: false });
                            if (existingPhone) {
                                return {
                                    code: "400",
                                    success: false,
                                    message: "Phone number is already used by another customer",
                                    data: null,
                                };
                            }
                            update.phone = phone;
                        }

                        update = {
                            ...update,
                            name,
                            state,
                            tags,
                            addresses,
                            email_marketing_consent,
                            sms_marketing_consent,
                            whatsapp_marketing_consent,
                            country,
                        };

                        const updatedDoc = await this.adapter.updateById(id, { $set: update });

                        if (!updatedDoc) {
                            throw new MoleculerError("Customer not found", 404, "NOT_FOUND");
                        }

                        return {
                            code: "200",
                            success: true,
                            message: "Customer updated successfully",
                            data: updatedDoc,
                        };
                    } else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                } catch (err) {
                    throw new MoleculerError("Customer update failed", 500, "INTERNAL_SERVER_ERROR", { error: err });
                }
            }
        },

        /**
         * Delete a customer by ID
         * @param {string} id - Customer ID to delete
         * This action is used to delete a customer from the database.
         */
        deleteAudience: {
            rest: {
                method: "DELETE",
                path: "/delete-customer",
            },
            auth: "required",
            params: {
                id: "string",
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                if (!org_id || !branch_id) {
                    throw { message: "Invalid headers", code: "400" };
                }

                try {
                    if (this.isUserAllowedToEdit(ctx)) {
                        if (!ObjectId.isValid(id)) {
                            throw new MoleculerError("Invalid customer ID", 400, "BAD_REQUEST");
                        }

                        const customer = await this.adapter.model.findByIdAndDelete(id);

                        if (!customer) {
                            throw new MoleculerError("Customer not found", 404, "NOT_FOUND");
                        }

                        const transformedData = customer.toJSON();

                        return {
                            code: "200",
                            success: true,
                            message: "Customer deleted successfully",
                            data: transformedData,
                        };
                    } else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    this.logger.error("Error in deleteCustomer action:", error);
                    throw new MoleculerError("Failed to delete customer", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            },
        },

        /**
         * Fetch audience overview statistics
         * @returns {object} - Returns an object containing total customers, email subscriptions, phone subscriptions, and suppressed customers
         */
        audienceOverview: {
            rest: {
                method: "GET",
                path: "/audience-overview",
            },
            auth: "required",
            async handler(ctx) {
                const { org_id, branch_id } = ctx.meta;

                if (!org_id || !branch_id) {
                    throw { message: "Invalid headers", code: "400" };
                }

                try {
                    if (this.isUserAllowedToEdit(ctx)) {
                        const [totalCustomers, totalNullEmail, totalNullPhone, totalSuppressed] = await Promise.all([
                            this.adapter.model.countDocuments({
                                org_id,
                                branch_id,
                                deleted: false,
                            }),
                            this.adapter.model.countDocuments({
                                org_id,
                                branch_id,
                                deleted: false,
                                email: null,
                            }),
                            this.adapter.model.countDocuments({
                                org_id,
                                branch_id,
                                deleted: false,
                                phone: null,
                            }),
                            this.adapter.model.countDocuments({
                                org_id,
                                branch_id,
                                deleted: false,
                                $and: [
                                    { email_marketing_consent: false },
                                    { whatsapp_marketing_consent: false },
                                    { sms_marketing_consent: false },
                                ],
                            }),
                        ]);

                        const records = {
                            total_customers: totalCustomers,
                            total_email_subscribed: totalCustomers - totalNullEmail,
                            total_phone_subscribed: totalCustomers - totalNullPhone,
                            total_suppressed: totalSuppressed,
                        };

                        return {
                            success: true,
                            message: "Audience Overview fetched successfully",
                            data: records,
                        };
                    }
                    else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                } catch (error) {
                    throw new MoleculerError("Failed to fetch audience overview", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            },
        },

        /**
         * Bulk update customers based on action
         * @param {array} customers - Array of customer IDs to update
         * @param {string} action - Action to perform on the customers
         * @param {object} data - Additional data required for the action
         * @param {boolean} allselect - Flag to indicate if all customers should be selected
         * @param {object} filter - Filter criteria to apply for bulk update
         */
        bulkCustomerUpdate: {
            rest: {
                method: "POST",
                path: "/bulk-customer-update",
            },
            auth: "required",
            params: {
                customers: { type: "array", items: "string", optional: true },
                action: {
                    type: "string", enum: ["subscribe_to_whatsapp", "export", "unsubscribe_to_whatsapp",
                        "subscribe_to_sms", "unsubscribe_to_sms", "subscribe_to_email", "unsubscribe_to_email", "subscribe", "unsubscribe",
                        "add_tag", "remove_tag", "add_to_list", "remove_from_list", "delete", "suppress", "unsuppress"],
                },
                data: { type: "any", optional: true },
                allselect: { type: "boolean", optional: true },
                filter: { type: "any", optional: true },
            },
            async handler(ctx) {
                try {
                    const { customers, action, data, allselect, filter } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    // Authorize user
                    if (!this.isUserAllowedToEdit(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    const aggregationQuery = CreateAggregation(org_id, branch_id, "", null, null, filter ? filter : null, null, null, false).slice(0, -2).map(e => e.$match);


                    if (action === "export") {
                        const query = allselect
                            ? { org_id, branch_id }
                            : { org_id, branch_id, _id: { $in: customers } };

                        ctx.call("bulkaction.exportCustomers", { query }).then((exportResult) => {
                            console.log("Export result:", exportResult);
                        }).catch((error) => {
                            console.error("Export error:", error);
                        });
                        return {
                            code: "200",
                            success: true,
                            message: "Customers export in progress",
                            data: null,
                        };
                    } else {
                        const query = allselect
                            ? { org_id, branch_id }
                            : { org_id, branch_id, _id: { $in: customers } };
                        ctx.call("bulkaction.bulkCustomerUpdate", { query, action, data }).then((exportResult) => {
                            console.log("Bulk update result:", exportResult);
                        }).catch((error) => {
                            console.error("Export error:", error);
                        });

                        return {
                            code: "200",
                            success: true,
                            message: "Request processed successfully",
                        };
                    }
                } catch (error) {
                    this.logger.error("Error in bulkCustomerUpdate action:", error);
                    throw new MoleculerError("Error processing bulk customer update", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            },
        },

        /**
         * Find customers with pagination and selection
         * @param {number} skip - Number of records to skip for pagination
         * @param {number} limit - Number of records to return
         * @param {object} query - Query parameters to filter customers
         * This actions is used for internal operations, not exposed via REST API
         */
        findCustomerWithSkipAndSelect: {
            auth: "required",
            params: {
                skip: { type: "number", optional: true },
                query: { type: "object" },
                select: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { skip, query, select } = ctx.params;
                const customers = await this.adapter.model.find(query).skip(skip).select(select);
                return customers;
            },
        },

        /**
         * Import customers from a CSV file
         * This action allows importing customers from a CSV file hosted on a CDN.
         * It processes the CSV file, validates the data, and inserts it into the database.
         * @param {string} cdnfile - URL of the CSV file on the CDN
         * @param {array} column - Array of objects defining the mapping between CSV headers and customer fields
         * @param {string} importDocId - Document ID for tracking the import process
         * @param {string} targetList - Optional target list to assign imported customers to
         */
        importCustomers: {
            rest: {
                method: "POST",
                path: "/import-customers"
            },
            auth: "required",
            params: {
                cdnfile: "string",
                column: { type: "array", items: "object" },
                targetList: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { cdnfile, column, targetList } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                try {
                    // Create a pending import history record
                    const pendingHistory = await customerimportModel.create({
                        branch_id: new ObjectId(branch_id),
                        org_id: new ObjectId(org_id),
                        title: formatImportHistoryTitle(new Date()),
                        filecdn: cdnfile,
                        status: "Pending",
                        customer_count: 0,
                        errorcdn: "",
                    });

                    await customerImportQueue.add("customer-import", {
                        cdnfile,
                        column,
                        targetList,
                        org_id,
                        branch_id,
                        importId: pendingHistory?._id?.toString(),
                    }, {
                        jobId: `customer-import-${org_id}-${branch_id}-${Date.now()}`
                    });

                    return {
                        success: true,
                        message: "Customer import initiated. You will be notified upon completion.",
                        data: { importId: pendingHistory?._id?.toString() },
                    };
                } catch (error) {
                    throw new MoleculerError("Failed to queue customer import", 500, "INTERNAL_SERVER_ERROR", { error: error.message || JSON.stringify(error) });
                }
            }
        },

        /**
         * Fetch single import history record by ID for progress polling
         */
        getImportHistoryById: {
            auth: "required",
            rest: {
                method: "GET"
            },
            params: {
                id: "string",
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const org_id = new ObjectId(ctx.meta.org_id);
                const branch_id = new ObjectId(ctx.meta.branch_id);
                try {
                    if (!this.isUserAllowedToView(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                    if (!ObjectId.isValid(id)) {
                        throw new MoleculerError("Invalid import history ID", 400, "BAD_REQUEST");
                    }
                    const doc = await customerimportModel.findOne({ _id: new ObjectId(id), org_id, branch_id });
                    if (!doc) {
                        throw new MoleculerError("Import history not found", 404, "NOT_FOUND");
                    }
                    return {
                        code: "200",
                        success: true,
                        message: "Import history fetched successfully",
                        data: doc,
                    };
                } catch (error) {
                    throw new MoleculerError("Failed to fetch import history", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            }
        },

        /**
         * Fetch import history for the organization
         * @param {number} page - Page number for pagination
         * @param {number} pageSize - Number of items per page
         * @param {string} search - Search term to filter import history by title
         * This action retrieves the import history for the organization, allowing pagination and search functionality.
         */
        ImportHistories: {
            auth: "required",
            rest: {
                method: "GET",
            },
            params: {
                page: { type: "number", integer: true, min: 1, optional: true, convert: true, default: 1 },
                pageSize: { type: "number", integer: true, min: 1, max: 100, optional: true, convert: true, default: 10 },
                search: { type: "string", optional: true, trim: true }
            },
            async handler(ctx) {
                console.log("Fetching exports for organisation ID:", ctx.meta.org_id);
                const orgId = new ObjectId(ctx.meta.org_id);
                const branch_id = new ObjectId(ctx.meta.branch_id);
                const page = ctx.params.page || 1;
                const pageSize = ctx.params.pageSize || 10;
                const skip = (page - 1) * pageSize;

                const query = {
                    org_id: orgId,
                    branch_id: branch_id
                };


                // Add search functionality
                if (ctx.params.search) {
                    const searchRegex = new RegExp(ctx.params.search, "i");
                    // Adjust the fields to search as needed
                    query.$or = [
                        { title: searchRegex }
                    ];
                }

                const sort = { createdAt: -1 };

                const [exports, total] = await Promise.all([
                    customerimportModel.find(query).sort(sort).skip(skip).limit(pageSize),
                    customerimportModel.countDocuments(query)
                ]);

                if (!exports || exports.length === 0) {
                    console.error("No import files found for organisation ID:", orgId);
                    return {
                        data: [],
                        success: false,
                        message: "No import files found",
                        pagination: {
                            page,
                            pageSize,
                            total,
                            totalPages: Math.ceil(total / pageSize)
                        }
                    };
                }

                return {
                    code: "200",
                    success: true,
                    message: "Customer Import History fetched successfully",
                    data: exports,
                    pagination: {
                        page,
                        pageSize,
                        total,
                        totalPages: Math.ceil(total / pageSize)
                    }
                };
            }
        },

        /**
         * Delete an import history record by ID
         * @param {string} id - Import history ID to delete
         */
        deleteImportHistory: {
            rest: {
                method: "DELETE",
                path: "/import-history/:id",
            },
            auth: "required",
            params: {
                id: "string",
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                if (!org_id || !branch_id) {
                    throw new MoleculerError("Invalid headers", 400, "BAD_REQUEST");
                }

                try {
                    if (this.isUserAllowedToEdit(ctx)) {
                        if (!ObjectId.isValid(id)) {
                            throw new MoleculerError("Invalid import history ID", 400, "BAD_REQUEST");
                        }

                        const deletedDoc = await customerimportModel.findByIdAndDelete(id);

                        if (!deletedDoc) {
                            throw new MoleculerError("Import history record not found", 404, "NOT_FOUND");
                        }

                        return {
                            code: "200",
                            success: true,
                            message: "Import history record deleted successfully",
                            data: deletedDoc,
                        };
                    } else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    this.logger.error("Error in deleteImportHistory action:", error);
                    throw new MoleculerError("Failed to delete import history record", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            },
        },

        bulkDeleteImportHistory: {
                rest: {
                    method: "DELETE",
                    path: "/import-history/bulk-delete",
                },
                auth: "required",
                params: {
                    ids: {
                        type: "array",
                        items: { type: "string" },
                        min: 1
                    }
                },
                async handler(ctx) {
                    const { ids } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (!org_id || !branch_id) {
                        throw new MoleculerError("Invalid headers", 400, "BAD_REQUEST");
                    }

                    try {
                        if (this.isUserAllowedToEdit(ctx)) {
                            // Validate all IDs are valid ObjectIds
                            const invalidIds = ids.filter(id => !ObjectId.isValid(id));
                            if (invalidIds.length > 0) {
                                throw new MoleculerError("Invalid import history ID(s)", 400, "BAD_REQUEST", {
                                    invalidIds: invalidIds
                                });
                            }

                            // Convert string IDs to ObjectIds
                            const objectIds = ids.map(id => new ObjectId(id));

                            // Find and delete all import history records
                            const deleteResult = await customerimportModel.deleteMany({
                                _id: { $in: objectIds }
                            });

                            if (deleteResult.deletedCount === 0) {
                                throw new MoleculerError("No import history records found to delete", 404, "NOT_FOUND");
                            }

                            // Send notification about bulk deletion
                            try {
                                await ctx.call("notification.send", {
                                    templateKey: "bulk_import_history_delete_completed",
                                    variables: {
                                        totalRecords: ids.length,
                                        deletedCount: deleteResult.deletedCount
                                    },
                                    additionalData: {
                                        organisation_id: org_id.toString(),
                                        user_id: ctx.meta.user_id || "",
                                        branch_id: branch_id.toString()
                                    }
                                });
                            } catch (notificationError) {
                                this.logger.error(`Failed to send notification for bulk import history delete: ${notificationError.message}`);
                                // Don't fail the main operation if notification fails
                            }

                            return {
                                code: "200",
                                success: true,
                                message: `Successfully deleted ${deleteResult.deletedCount} out of ${ids.length} import history records`,
                                data: {
                                    totalRequested: ids.length,
                                    deletedCount: deleteResult.deletedCount,
                                    failedCount: ids.length - deleteResult.deletedCount
                                }
                            };
                        } else {
                            throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                        }
                    } catch (error) {
                        this.logger.error("Error in bulkDeleteImportHistory action:", error);

                        if (error instanceof MoleculerError) {
                            throw error;
                        }

                        throw new MoleculerError("Failed to delete import history records", 500, "INTERNAL_SERVER_ERROR", { error });
                    }
                },
            },

        /**
         * Get segments a customer belongs to
         * @param {string} customerId - ID of the customer
         * @returns {array} - Array of segments the customer belongs to
         */
        getCustomerSegments: {
            rest: {
                method: "GET",
                path: "/:customerId/segments",
            },
            auth: "required",
            params: {
                id: "string",
            },
            async handler(ctx) {
                try {
                    const { id } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (!this.isUserAllowedToView(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    if (!ObjectId.isValid(id)) {
                        throw new MoleculerError("Invalid customer ID", 400, "BAD_REQUEST");
                    }

                    const customer = await this.adapter.model.findById(id);
                    if (!customer) {
                        throw new MoleculerError("Customer not found", 404, "NOT_FOUND");
                    }

                    const segments = await segmentModel.find({ org_id: org_id, branch_id: branch_id });
                    const customerSegments = [];


                    for (const segment of segments) {
                        if (segment.rules) {
                            try {
                                const filter = JSON.parse(segment.rules);
                                const aggregationQuery = CreateAggregation(org_id, branch_id, null, null, null, filter, null, null, false);

                                // Add a match for the specific customer ID
                                aggregationQuery[0].$match = {
                                    ...aggregationQuery[0].$match,
                                    _id: new ObjectId(id)
                                };
                                console.log("Aggregation Query:", JSON.stringify(aggregationQuery, null, 2));
                                const count = await this.adapter.model.countDocuments(aggregationQuery[0].$match);
                                if (count > 0) {
                                    customerSegments.push(segment);
                                }
                            } catch (error) {
                                this.logger.warn(`Failed to parse or apply rules for segment ${segment._id}: ${error.message}`);
                            }
                        }
                    }

                    return {
                        code: "200",
                        success: true,
                        message: "Customer segments fetched successfully",
                        data: customerSegments,
                    };
                } catch (error) {
                    this.logger.error("Error in getCustomerSegments action:", error);
                    throw new MoleculerError("Failed to fetch customer segments", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            },
        },

        /**
         * Save or update customer table column order
         * @param {string} name - Name of the column order (e.g., "default")
         * @param {array} columns - Array of column objects
         */
        saveCustomerColumnOrder: {
            rest: {
                method: "POST",
                path: "/customer-column-order",
            },
            auth: "required",
            params: {
                columns: {
                    type: "array", items: {
                        type: "object", props: {
                            key: "string",
                            type: "string",
                            label: "string",
                        }
                    }
                },
            },
            async handler(ctx) {
                const { columns } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                try {
                    if (this.isUserAllowedToEdit(ctx)) {
                        let doc = await CustomerColumnOrderModel.findOneAndUpdate(
                            { org_id: new ObjectId(org_id), branch_id: new ObjectId(branch_id) },
                            { columns: columns },
                            { upsert: true, new: true }
                        );
                        return {
                            success: true,
                            message: "Customer column order saved successfully",
                            data: doc,
                        };
                    } else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    this.logger.error("Error in saveCustomerColumnOrder action:", error);
                    throw new MoleculerError("Failed to save customer column order", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            },
        },

        getCustomerColumnOrder: {
            rest: {
                method: "GET",
                path: "/customer-column-order",
            },
            auth: "required",
            async handler(ctx) {
                const { org_id, branch_id } = ctx.meta;
                try {
                    if (!this.isUserAllowedToView(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                    const columnOrder = await CustomerColumnOrderModel.findOne({ org_id: new ObjectId(org_id), branch_id: new ObjectId(branch_id) });
                    if (!columnOrder) {
                        return {
                            success: false,
                            message: "Customer column order not found",
                            data: null
                        }
                    }
                    return {
                        success: true,
                        message: "Customer column order fetched successfully",
                        data: columnOrder,
                    };
                } catch (error) {
                    this.logger.error("Error in getCustomerColumnOrder action:", error);
                    throw new MoleculerError("Failed to fetch customer column order", 500, "INTERNAL_SERVER_ERROR", { error });
                }
            },
        },

        /**
         * Export audience profiles with comprehensive data
         * @param {object} query - Query parameters to filter customers
         * @param {string} exportType - Type of export (csv, json, xlsx)
         * @param {array} fields - Specific fields to export
         * @param {string} title - Export title
         * @param {boolean} includeTags - Include customer tags
         * @param {boolean} includeLists - Include customer lists
         * @param {boolean} includeMetadata - Include customer metadata
         */
        exportAudienceProfiles: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/export-profiles"
            },
            params: {
                query: { type: "object", optional: true, default: {} },
                exportType: { type: "string", optional: true, default: "csv", enum: ["csv", "json", "xlsx"] },
                fields: { type: "array", optional: true },
                title: { type: "string", optional: true },
                includeTags: { type: "boolean", optional: true, default: true },
                includeLists: { type: "boolean", optional: true, default: true },
                includeMetadata: { type: "boolean", optional: true, default: true }
            },
            async handler(ctx) {
                try {
                    if (!this.isUserAllowedToView(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    // Delegate to the profile export service
                    const result = await ctx.call("profileexport.initiateProfileExport", {
                        query: ctx.params.query,
                        exportType: ctx.params.exportType,
                        fields: ctx.params.fields,
                        title: ctx.params.title,
                        includeTags: ctx.params.includeTags,
                        includeLists: ctx.params.includeLists,
                        includeMetadata: ctx.params.includeMetadata
                    });

                    return result;
                } catch (error) {
                    this.logger.error("Error in exportAudienceProfiles action:", error);
                    throw new MoleculerError(
                        error.message || "Failed to export audience profiles",
                        error.code || 500,
                        error.type || "EXPORT_FAILED"
                    );
                }
            }
        },

        /**
         * Export a single customer profile by ID
         * @param {string} customerId - Customer ID to export
         * @param {string} exportType - Type of export (csv, json, xlsx)
         * @param {array} fields - Specific fields to export
         * @param {string} title - Export title
         * @param {boolean} includeTags - Include customer tags
         * @param {boolean} includeLists - Include customer lists
         * @param {boolean} includeMetadata - Include customer metadata
         */
        exportProfileById: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/export-profile-by-id"
            },
            params: {
                customerId: { type: "string", min: 1 },
                exportType: { type: "string", optional: true, default: "json", enum: ["csv", "json", "xlsx"] },
                fields: { type: "array", optional: true },
                title: { type: "string", optional: true },
                includeTags: { type: "boolean", optional: true, default: true },
                includeLists: { type: "boolean", optional: true, default: true },
                includeMetadata: { type: "boolean", optional: true, default: true }
            },
            async handler(ctx) {
                try {
                    if (!this.isUserAllowedToView(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    // Delegate to the profile export service
                    const result = await ctx.call("profileexport.exportProfileById", {
                        customerId: ctx.params.customerId,
                        exportType: ctx.params.exportType,
                        fields: ctx.params.fields,
                        title: ctx.params.title,
                        includeTags: ctx.params.includeTags,
                        includeLists: ctx.params.includeLists,
                        includeMetadata: ctx.params.includeMetadata
                    });

                    return result;
                } catch (error) {
                    this.logger.error("Error in exportProfileById action:", error);
                    throw new MoleculerError(
                        error.message || "Failed to export profile by ID",
                        error.code || 500,
                        error.type || "EXPORT_BY_ID_FAILED"
                    );
                }
            }
        },

        /**
         * Add a single audience to a specific list
         * @param {string} customerId - Customer ID to add to the list
         * @param {string} listId - List ID to add the customer to
         * @returns {object} - Returns success message and updated customer data
         */
        addAudienceToList: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/add-audience-to-list"
            },
            params: {
                customerId: { type: "string", description: "Customer ID to add to the list" },
                listId: { type: "string", description: "List ID to add the customer to" }
            },
            async handler(ctx) {
                try {
                    const { customerId, listId } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (!this.isUserAllowedToEdit(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    // Validate ObjectIds
                    if (!ObjectId.isValid(customerId)) {
                        throw new MoleculerError("Invalid customer ID format", 400, "BAD_REQUEST");
                    }

                    if (!ObjectId.isValid(listId)) {
                        throw new MoleculerError("Invalid list ID format", 400, "BAD_REQUEST");
                    }

                    // Check if the customer exists and belongs to the current org/branch
                    const customer = await this.adapter.findOne({
                        _id: new ObjectId(customerId),
                        org_id,
                        branch_id
                    });

                    if (!customer) {
                        throw new MoleculerError("Customer not found", 404, "NOT_FOUND");
                    }

                    // Check if the list exists and belongs to the current org/branch
                    const list = await ctx.call("list.getListById", { id: listId });

                    if (!list.success) {
                        throw new MoleculerError("List not found", 404, "NOT_FOUND");
                    }

                    // Check if customer is already in the list
                    const isAlreadyInList = customer.lists && customer.lists.some(listObjId =>
                        listObjId.toString() === listId
                    );

                    if (isAlreadyInList) {
                        return {
                            code: "200",
                            success: true,
                            message: "Customer is already in the list",
                            data: customer
                        };
                    }

                    // Add customer to the list
                    const updatedCustomer = await this.adapter.updateById(customerId, {
                        $addToSet: { lists: new ObjectId(listId) },
                        $set: { updatedAt: new Date() }
                    });

                    if (!updatedCustomer) {
                        throw new MoleculerError("Failed to add customer to list", 500, "INTERNAL_SERVER_ERROR");
                    }

                    return {
                        code: "200",
                        success: true,
                        message: "Customer successfully added to the list",
                        data: updatedCustomer
                    };

                } catch (error) {
                    this.logger.error("Error in addAudienceToList action:", error);

                    if (error instanceof MoleculerError) {
                        throw error;
                    }

                    throw new MoleculerError(
                        error.message || "Failed to add customer to list",
                        error.code || 500,
                        error.type || "INTERNAL_SERVER_ERROR"
                    );
                }
            }
        },

        /**
         * Remove a single audience from a specific list
         * @param {string} customerId - Customer ID to remove from the list
         * @param {string} listId - List ID to remove the customer from
         * @returns {object} - Returns success message and updated customer data
         */
        removeFromList: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/remove-from-list"
            },
            params: {
                customerId: { type: "string", description: "Customer ID to remove from the list" },
                listId: { type: "string", description: "List ID to remove the customer from" }
            },
            async handler(ctx) {
                try {
                    const { customerId, listId } = ctx.params;
                    const { org_id, branch_id } = ctx.meta;

                    if (!this.isUserAllowedToEdit(ctx)) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    // Validate ObjectIds
                    if (!ObjectId.isValid(customerId)) {
                        throw new MoleculerError("Invalid customer ID format", 400, "BAD_REQUEST");
                    }

                    if (!ObjectId.isValid(listId)) {
                        throw new MoleculerError("Invalid list ID format", 400, "BAD_REQUEST");
                    }

                    // Check if the customer exists and belongs to the current org/branch
                    const customer = await this.adapter.findOne({
                        _id: new ObjectId(customerId),
                        org_id,
                        branch_id
                    });

                    if (!customer) {
                        throw new MoleculerError("Customer not found", 404, "NOT_FOUND");
                    }

                    // Check if the list exists and belongs to the current org/branch
                    const list = await ctx.call("list.getListById", { id: listId });

                    if (!list.success) {
                        throw new MoleculerError("List not found", 404, "NOT_FOUND");
                    }

                    // Check if customer is in the list
                    const isInList = customer.lists && customer.lists.some(listObjId =>
                        listObjId.toString() === listId
                    );

                    if (!isInList) {
                        return {
                            code: "200",
                            success: true,
                            message: "Customer is not in the list",
                            data: customer
                        };
                    }

                    // Remove customer from the list
                    const updatedCustomer = await this.adapter.updateById(customerId, {
                        $pull: { lists: new ObjectId(listId) },
                        $set: { updatedAt: new Date() }
                    });

                    if (!updatedCustomer) {
                        throw new MoleculerError("Failed to remove customer from list", 500, "INTERNAL_SERVER_ERROR");
                    }

                    return {
                        code: "200",
                        success: true,
                        message: "Customer successfully removed from the list",
                        data: updatedCustomer
                    };

                } catch (error) {
                    this.logger.error("Error in removeFromList action:", error);

                    if (error instanceof MoleculerError) {
                        throw error;
                    }

                    throw new MoleculerError(
                        error.message || "Failed to remove customer from list",
                        error.code || 500,
                        error.type || "INTERNAL_SERVER_ERROR"
                    );
                }
            }
        },
    },

    started() {
        this.logger.info("Customer service started.");
    },

    methods: {
        /**
         * Perform customer search with configurable search method
         * @param {Object} params - Search parameters
         * @param {string} params.search - Search term
         * @param {string} params.page - Page number
         * @param {string} params.pageSize - Page size
         * @param {Object} params.filter - Additional filters
         * @param {boolean} params.useRegexSearch - Whether to use regex search (default: false)
         * @param {Object} ctx - Moleculer context
         * @returns {Object} - Search results with pagination
         */
        async performCustomerSearch(params, ctx) {
            const { pageSize, page, search, filter, useRegexSearch = false } = params;
            const parsedFilter = filter ? JSON.parse(filter) : null;
            const org_id = new ObjectId(ctx.meta.org_id);
            const branch_id = new ObjectId(ctx.meta.branch_id);

            // Use regex search if specified, otherwise fall back to text search
            const aggregationQuery = CreateAggregation(org_id, branch_id, search, null, null, parsedFilter, null, null, false, useRegexSearch);

            if (aggregationQuery[0]?.$match?.lists?.$in) {
                aggregationQuery[0].$match.lists.$in = aggregationQuery[0].$match.lists.$in.map(id => new ObjectId(id));
            }

            const updateIdsInCondition = (condition) => {
                if (condition?.lists?.$in) {
                    condition.lists.$in = condition.lists.$in.map(id => {
                        if (Array.isArray(id)) {
                            return id.map(innerId => new ObjectId(id));
                        }
                        return new ObjectId(id);
                    });
                }
                return condition;
            };

            const traverseAndUpdate = (query) => {
                if (query?.$and) {
                    query.$and = query.$and.map(traverseAndUpdate);
                } else if (query?.$or) {
                    query.$or = query.$or.map(traverseAndUpdate);
                } else {
                    query = updateIdsInCondition(query);
                }
                return query;
            };

            aggregationQuery[0].$match = traverseAndUpdate(aggregationQuery[0].$match);
            const skipValue = (parseInt(page) - 1) * parseInt(pageSize);
            aggregationQuery.push(
                { $skip: skipValue },
                { $limit: parseInt(pageSize) }
            );

            // Get total count for pagination info
            const total = await this.adapter.model.countDocuments(aggregationQuery[0].$match || {});

            const searchMethod = useRegexSearch ? "regex search" : "text search";
            console.log(`${searchMethod.charAt(0).toUpperCase() + searchMethod.slice(1)} Aggregation Query:`, JSON.stringify(aggregationQuery, null, 2));

            let records = await this.adapter.model.aggregate([
                ...aggregationQuery,
                {
                    $lookup: {
                        from: "tags",
                        localField: "tags",
                        foreignField: "_id",
                        as: "tags",
                    },
                }
            ]);

            const pageInfo = {
                total: total,
                page: parseInt(page),
                pageSize: parseInt(pageSize),
                totalPages: Math.ceil(total / parseInt(pageSize)),
            };

            return {
                code: "200",
                success: true,
                message: `Customers fetched successfully using ${searchMethod}`,
                data: records,
                pagination: pageInfo,
            };
        },

        /**
         * Check if user is allowed to edit customer data
         * @param {*} ctx 
         * @returns 
         */
        isUserAllowedToEdit(ctx) {
            if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                return true;
            }
            else {
                return false;
            }
        },

        /**
         * Check if user is allowed to view customer data
         * @param {*} ctx 
         * @returns 
         */
        isUserAllowedToView(ctx) {
            try {
                if (ctx.meta.scopes.includes("customer_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("customer_write")) {
                    return true;
                }
                else {
                    return false;
                }
            } catch (error) {
                console.error("Error checking user permissions:", error);
                return false;
            }
        },

        /**
         * Add a new import history record after customer import operation
         * @param {number} insertedCount - Number of successfully inserted customers
         * @param {string} errorcdnlink - CDN link to errored rows file (if any)
         * @param {string} branch_id - Branch ID
         * @param {string} org_id - Organization ID
         */
        async AddImportHistory(insertedCount, cdnfile, errorcdnlink, branch_id, org_id) {
            await customerimportModel.create({
                branch_id,
                org_id,
                title: formatImportHistoryTitle(new Date()),
                filecdn: cdnfile,
                status: 'Completed',
                customer_count: insertedCount,
                errorcdn: errorcdnlink,
            });
        }
    }
};
