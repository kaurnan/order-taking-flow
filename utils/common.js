const argon2 = require("argon2");
const axios = require("axios");
const { parsePhoneNumber } = require("awesome-phonenumber");
const { ObjectId } = require("mongodb");
const { connectMongo } = require("../models/init-db");
const IntegrationModel = require("../models/integrations.model");
const CampaignModel = require("../models/flow/campaign.model");
const path = require("path");
const { ExecutionsClient } = require("@google-cloud/workflows");
const keyFilename = path.join(__dirname, "../gcp/service_account.json");
const Executionclient = new ExecutionsClient({ keyFilename });
const countryList = require("countries-list");
dotenv = require("dotenv");
dotenv.config();

async function comparePassword(hashValue, password) {
    try {
        if (await argon2.verify(hashValue, password)) {
            return true;
        } else {
            return false;
        }
    } catch (err) {
        throw Error(`hash Verify Error: ${err}`);
    }
}

function generateOtp(length = 6) {
    const digits = "0123456789";
    let otp = "";
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
}

async function exchangeToken(code) {
    try {
        const response = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&code=${code}`);
        return response.data;
    } catch (error) {
        console.error("Error exchanging token:", error.message);
        return null;
    }
}

async function FetchSharedWABAIDs(accessToken) {
    try {
        console.log(`Fetching shared WABA IDs with access token: ${accessToken}`);
        console.log(`Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`);
        return axios.get(`https://graph.facebook.com/v20.0/debug_token?input_token=${accessToken}`, {
            headers: {
                Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`,
            },
        });
    } catch (error) {
        console.log(error);
        console.error("Error fetching shared WABA IDs:", error.message);
        return null;
    }
}

async function FetchPhoneNumbers(accessToken, wabaId) {
    try {
        console.log(`Fetching phone numbers with access token: ${accessToken}`);
        return axios.get(`https://graph.facebook.com/v20.0/${wabaId}/phone_numbers?access_token=${accessToken}`, {
            headers: {
                Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`,
            },
        });
    } catch (error) {
        console.error("Error fetching phone numbers:", error.message);
        return null;
    }
}

async function ADDSystemUserToWABA(wabaID) {
    try {
        return axios.post(`https://graph.facebook.com/v20.0/${wabaID}/assigned_users`, {
            user: `${process.env.SYSTEM_USER_ID}`,
            tasks: ["MANAGE_TEMPLATES"],
        }, {
            headers: {
                Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`,
            },
        });
    } catch (error) {
        console.error("Error adding system user to WABA:", error.message);
        return null;
    }
}

async function SubscribeAppToWaba(wabaID) {
    try {
        return axios.post(`https://graph.facebook.com/v20.0/${wabaID}/subscribed_apps`, {
            subscribed_fields: ["messages", "messaging_postbacks"],
        }, {
            headers: {
                Authorization: `Bearer ${process.env.CLOUD_API_ACCESS_TOKEN}`,
            },
        });
    } catch (error) {
        console.error("Error subscribing app to WABA:", error.message);
        return null;
    }
}

function FormatPhoneNumber(phone, regionCode) {
    try {
        let phoneInput = phone;
        if (typeof phoneInput === "number") {
            phoneInput = phoneInput.toString();
        }
        // If phone already starts with '+', don't add another '+'
        phoneInput = phoneInput.startsWith("+") ? phoneInput : `+${phoneInput}`;
        // If regionCode is provided, use it in parsePhoneNumber
        const pn = regionCode ? parsePhoneNumber(phone, { regionCode }) : parsePhoneNumber(phoneInput);
        if (!pn.valid) {
            return null;
        }
        return pn?.number?.international || null;
    } catch (error) {
        console.error("Error formatting phone number:", error.message, phone, regionCode);
        return null;
    }
}

/**
 * Create regex search query for partial text matching
 * @param {string} searchTerm - The search term to match
 * @param {Array} searchFields - Array of field names to search in
 * @returns {Object} - MongoDB query object with $or conditions for regex search
 */
function createRegexSearchQuery(searchTerm, searchFields = ['name', 'email', 'phone']) {
    if (!searchTerm || searchTerm.trim() === '') {
        return {};
    }

    const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexPattern = new RegExp(escapedSearchTerm, 'i'); // Case-insensitive search

    const $or = searchFields.map(field => ({
        [field]: { $regex: regexPattern }
    }));

    return { $or };
}

/**
 * Create aggregation pipeline with support for both text search and regex search
 * @param {string} org_id - Organization ID
 * @param {string} branch_id - Branch ID
 * @param {string} search - Search term
 * @param {string} first - First cursor for pagination
 * @param {string} last - Last cursor for pagination
 * @param {object} filter - Additional filters
 * @param {string} after - After cursor for pagination
 * @param {string} before - Before cursor for pagination
 * @param {boolean} deleteflag - Whether to include deleted records
 * @param {boolean} useRegexSearch - Whether to use regex search instead of text search
 * @returns {Array} - Aggregation pipeline array
 */
function CreateAggregation(org_id, branch_id, search, first, last, filter, after, before, deleteflag = true, useRegexSearch = true) {

    const matchQuery = {
        org_id: org_id,
    };

    if (deleteflag) {
        matchQuery.deleted = false;
    }

    if (branch_id) {
        matchQuery.branch_id = branch_id;
    }

    const addFieldsQuery = {
        score: { $meta: "textScore" },
    };

    const sortQuery = {};

    if (search && search.trim() !== "") {
        if (useRegexSearch) {
            // Optimized regex: anchored prefixes on key fields only
            const term = search.trim();
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const phoneDigits = term.replace(/\D/g, "");
            const orClauses = [];

            if (escaped) {
                orClauses.push({ name: { $regex: `^${escaped}`, $options: "i" } });
                orClauses.push({ email: { $regex: `^${escaped}`, $options: "i" } });
            }
            if (phoneDigits) {
                orClauses.push({ phone: { $regex: `^${phoneDigits}` } });
            }

            if (orClauses.length > 0) {
                Object.assign(matchQuery, { $or: orClauses });
            }
            // Avoid per-document scoring in regex mode for performance
        } else {
            // Use existing text search for exact matches
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(search)) {
                const emailPrefix = search.split("@")[0];
                matchQuery.$text = { $search: emailPrefix };
                sortQuery.score = { $meta: "textScore" };
            } else {
                matchQuery.$text = { $search: search };
                sortQuery.score = { $meta: "textScore" };
            }
        }
    }

    // Sort by score if search is used, otherwise by ID
    if (search && useRegexSearch) {
        // Stable sort for regex mode
        sortQuery.updatedAt = -1;
        sortQuery._id = -1;
    } else if (search && !useRegexSearch) {
        sortQuery.score = { $meta: "textScore" };
    }

    sortQuery._id = last ? 1 : -1;

    if (filter && filter._id && filter._id.$in) {
        matchQuery._id = { $in: filter._id.$in.map((id) => new ObjectId(id)) };
        delete filter._id;
    }

    if (filter) {
        Object.assign(matchQuery, formatQuery(filter));
    }

    if (after) {
        matchQuery._id = { $lt: after };
    } else if (before) {
        matchQuery._id = { $gt: before };
    }

    const aggregationQuery = [{ $match: matchQuery }, { $sort: sortQuery }];

    if (search && !useRegexSearch) {
        aggregationQuery.splice(1, 0, { $addFields: addFieldsQuery });
    }

    return aggregationQuery;
}

/**
 * Create aggregation pipeline for list model
 * @param {string} org_id - Organization ID
 * @param {string} branch_id - Branch ID
 * @param {string} search - Search term
 * @param {number} first - First items to return
 * @param {number} last - Last items to return
 * @param {object} filter - Additional filters
 * @param {string} after - Cursor for pagination (after this ID)
 * @param {string} before - Cursor for pagination (before this ID)
 * @param {boolean} deleteflag - Whether to include deleted items
 * @param {boolean} useRegexSearch - Whether to use regex search
 * @returns {Array} Aggregation pipeline
 */
function CreateListAggregation(org_id, branch_id, search, first, last, filter, after, before, deleteflag = true, useRegexSearch = true) {

    const matchQuery = {
        org_id: org_id,
    };

    if (deleteflag) {
        matchQuery.deleted = false;
    }

    if (branch_id) {
        matchQuery.branch_id = branch_id;
    }

    const addFieldsQuery = {
        score: { $meta: "textScore" },
    };

    const sortQuery = {};

    if (search && search.trim() !== "") {
        if (useRegexSearch) {
            // Optimized regex: anchored prefixes on key fields for lists
            const term = search.trim();
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const orClauses = [];

            if (escaped) {
                orClauses.push({ title: { $regex: `^${escaped}`, $options: "i" } });
                orClauses.push({ description: { $regex: `^${escaped}`, $options: "i" } });
            }

            if (orClauses.length > 0) {
                Object.assign(matchQuery, { $or: orClauses });
            }
            // Avoid per-document scoring in regex mode for performance
        } else {
            // Use existing text search for exact matches
            matchQuery.$text = { $search: search };
            sortQuery.score = { $meta: "textScore" };
        }
    }

    // Sort by score if search is used, otherwise by creation date
    if (search && useRegexSearch) {
        // Stable sort for regex mode
        sortQuery.created_at = -1;
        sortQuery._id = -1;
    } else if (search && !useRegexSearch) {
        sortQuery.score = { $meta: "textScore" };
    }

    // Default sort by creation date (newest first)
    sortQuery.created_at = last ? 1 : -1;

    if (filter && filter._id && filter._id.$in) {
        matchQuery._id = { $in: filter._id.$in.map((id) => new ObjectId(id)) };
        delete filter._id;
    }

    if (filter) {
        Object.assign(matchQuery, formatQuery(filter));
    }

    if (after) {
        matchQuery._id = { $lt: after };
    } else if (before) {
        matchQuery._id = { $gt: before };
    }

    const aggregationQuery = [{ $match: matchQuery }, { $sort: sortQuery }];

    if (search && !useRegexSearch) {
        aggregationQuery.splice(1, 0, { $addFields: addFieldsQuery });
    }

    return aggregationQuery;
}

/**
 * Create aggregation pipeline for segment model
 * @param {string} org_id - Organization ID
 * @param {string} branch_id - Branch ID
 * @param {string} search - Search term
 * @param {number} first - First items to return
 * @param {number} last - Last items to return
 * @param {object} filter - Additional filters
 * @param {string} after - Cursor for pagination (after this ID)
 * @param {string} before - Cursor for pagination (before this ID)
 * @param {boolean} deleteflag - Whether to include deleted items
 * @param {boolean} useRegexSearch - Whether to use regex search
 * @returns {Array} Aggregation pipeline
 */
function CreateSegmentAggregation(org_id, branch_id, search, first, last, filter, after, before, deleteflag = true, useRegexSearch = true) {

    const matchQuery = {
        org_id: org_id,
    };

    if (deleteflag) {
        matchQuery.deleted = false;
    }

    if (branch_id) {
        matchQuery.branch_id = branch_id;
    }

    const addFieldsQuery = {
        score: { $meta: "textScore" },
    };

    const sortQuery = {};

    if (search && search.trim() !== "") {
        if (useRegexSearch) {
            // Optimized regex: anchored prefixes on key fields for segments
            const term = search.trim();
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const orClauses = [];

            if (escaped) {
                orClauses.push({ title: { $regex: `^${escaped}`, $options: "i" } });
            }

            if (orClauses.length > 0) {
                Object.assign(matchQuery, { $or: orClauses });
            }
            // Avoid per-document scoring in regex mode for performance
        } else {
            // Use existing text search for exact matches
            matchQuery.$text = { $search: search };
            sortQuery.score = { $meta: "textScore" };
        }
    }

    // Sort by score if search is used, otherwise by creation date
    if (search && useRegexSearch) {
        // Stable sort for regex mode
        sortQuery.created_at = -1;
        sortQuery._id = -1;
    } else if (search && !useRegexSearch) {
        sortQuery.score = { $meta: "textScore" };
    }

    // Default sort by creation date (newest first)
    sortQuery.created_at = last ? 1 : -1;

    if (filter && filter._id && filter._id.$in) {
        matchQuery._id = { $in: filter._id.$in.map((id) => new ObjectId(id)) };
        delete filter._id;
    }

    if (filter) {
        Object.assign(matchQuery, formatQuery(filter));
    }

    if (after) {
        matchQuery._id = { $lt: after };
    } else if (before) {
        matchQuery._id = { $gt: before };
    }

    const aggregationQuery = [{ $match: matchQuery }, { $sort: sortQuery }];

    if (search && !useRegexSearch) {
        aggregationQuery.splice(1, 0, { $addFields: addFieldsQuery });
    }

    return aggregationQuery;
}

function getPageLimit(input) {
    if (input >= 100) {
        return 100;
    } else {
        return input;
    }
}

function generateProjection(fields, prefix = "") {
    const projection = {};
    for (const [fieldName, fieldInfo] of Object.entries(fields)) {
        const typedFieldInfo = fieldInfo;
        const fullFieldName = prefix + typedFieldInfo.name;
        if (Object.keys(typedFieldInfo.fieldsByTypeName).length !== 0) {
            const keyvalue = Object.entries(typedFieldInfo.fieldsByTypeName)[0];
            const nestedProjection = generateProjection(keyvalue[1], "");
            projection[fullFieldName] = nestedProjection;
        } else {
            if (fullFieldName == "total_spent") {
                projection[fullFieldName] = { $toDouble: "$total_spent" };
            } else {
                projection[fullFieldName] = 1;
            }
        }
    }
    return projection;
}

function formatQuery(query) {
    const formattedQuery = {};

    function formatOperators(obj) {
        const result = {};

        for (const key in obj) {
            if (key === "$AND" || key === "$and") {
                result.$and = obj[key].map(formatOperators);
            } else if (key === "$OR" || key === "$or") {
                result.$or = obj[key].map(formatOperators);
            } else if (typeof obj[key] === "object") {
                const innerKey = Object.keys(obj[key])[0];
                const value = obj[key][innerKey];
                const dayStart = new Date(value);
                dayStart.setUTCHours(0, 0, 0, 0);

                // 2. Compute the very start of the next calendar day
                const nextDay = new Date(dayStart);
                nextDay.setUTCDate(dayStart.getUTCDate() + 1);
                nextDay.setDate(dayStart.getDate() + 1);

                const arrValue = Array.isArray(value) ? value : [value];

                switch (innerKey) {
                    case "number_less_than_or_equal":
                        result[key] = { $lte: Number(value) };
                        break;
                    case "number_greater_than_or_equal":
                        result[key] = { $gte: Number(value) };
                        break;
                    case "number_not_equal":
                        result[key] = { $ne: Number(value) };
                        break;
                    case "number_less_than":
                        result[key] = { $lt: Number(value) };
                        break;
                    case "number_greater_than":
                        result[key] = { $gt: Number(value) };
                        break;
                    case "number_equals":
                        result[key] = { $eq: Number(value) };
                        break;
                    case "date_equals":
                        result[key] = {
                            $gte: dayStart,
                            $lt: nextDay
                        };
                        break;

                    case "date_greater_than":
                        result[key] = {
                            $gte: nextDay
                        };
                        break;

                    case "date_less_than":
                        result[key] = {
                            $lt: dayStart
                        };
                        break;

                    case "date_greater_than_or_equal":
                        result[key] = {
                            $gte: dayStart
                        };
                        break;

                    case "date_less_than_or_equal":
                        result[key] = {
                            $lt: nextDay
                        };
                        break;

                    case "date_after":
                        // strictly after the given date
                        result[key] = {
                            $gte: nextDay
                        };
                        break;
                    case "text_equals_to_case_sensitive":
                        result[key] = { $eq: value };
                        break;
                    case "text_equals_to_case_insensitive":
                        result[key] = { $regex: new RegExp(`^${value}$`, "i") };
                        break;
                    case "text_not_equal_to_case_sensitive":
                        result[key] = { $ne: value };
                        break;
                    case "text_not_equal_to_case_insensitive":
                        result[key] = { $not: { $regex: new RegExp(`^${value}$`, "i") } };
                        break;
                    case "text_contains_case_sensitive":
                        result[key] = { $regex: value };
                        break;
                    case "text_contains_case_insensitive":
                        result[key] = { $regex: new RegExp(value, "i") };
                        break;
                    case "text_does_not_contain_case_sensitive":
                        result[key] = { $not: { $regex: value } };
                        break;
                    case "text_does_not_contain_case_insensitive":
                        result[key] = { $not: { $regex: new RegExp(value, "i") } };
                        break;
                    case "text_starts_with_case_sensitive":
                        result[key] = { $regex: new RegExp(`^${value}`) };
                        break;
                    case "text_starts_with_case_insensitive":
                        result[key] = { $regex: new RegExp(`^${value}`, "i") };
                        break;
                    case "text_does_not_start_with_case_sensitive":
                        result[key] = { $not: { $regex: new RegExp(`^${value}`) } };
                        break;
                    case "text_does_not_start_with_case_insensitive":
                        result[key] = { $not: { $regex: new RegExp(`^${value}`, "i") } };
                        break;
                    case "text_ends_with_case_sensitive":
                        result[key] = { $regex: new RegExp(`${value}$`) };
                        break;
                    case "text_ends_with_case_insensitive":
                        result[key] = { $regex: new RegExp(`${value}$`, "i") };
                        break;
                    case "text_does_not_end_with_case_sensitive":
                        result[key] = { $not: { $regex: new RegExp(`${value}$`) } };
                        break;
                    case "text_does_not_end_with_case_insensitive":
                        result[key] = { $not: { $regex: new RegExp(`${value}$`, "i") } };
                        break;
                    case "boolean_is_true":
                        result[key] = { $eq: true };
                        break;
                    case "boolean_is_false":
                        result[key] = { $eq: false };
                        break;
                    case "does_not_exist":
                        result[key] = { $exists: false };
                        break;
                    case "is_null":
                        result[key] = { $eq: null };
                        break;
                    case "is_not_null":
                        result[key] = { $ne: null };
                        break;
                    case "array_contains":
                        if (key === "lists") {
                            result[key] = { $in: arrValue };
                        } else {
                            result[key] = { $elemMatch: { name: { $in: arrValue } } };
                        }
                        break;
                    case "array_does_not_contains":
                        if (key === "lists") {
                            result[key] = { $not: { $in: arrValue } };
                        } else if (key === "tags") {
                            result[key] = {
                                $not: {
                                    $elemMatch: { name: { $in: arrValue } },
                                },
                            };
                        }
                        break;

                    case "array_is_null":
                        result[key] = { $size: 0 };
                        break;

                    case "array_is_not_null":
                        result[key] = { $exists: true, $ne: [] };
                        break;
                    default:
                        result[key] = obj[key];
                        break;
                }
                if (innerKey === "string_equals") {
                    result[key] = { $eq: value };
                } else if (innerKey === "number_less_than") {
                    result[key] = { $lt: Number(value) };
                }
            }
        }

        return result;
    }

    Object.assign(formattedQuery, formatOperators(query));
    return formattedQuery;
}

function getTimeZoneFromOffset(offset) {
    const timeZoneMap = {
        "-330": "Asia/Kolkata",
        "-300": "America/New_York",
        "-420": "America/Los_Angeles",
        "-240": "Asia/Dubai",
    };
    return timeZoneMap[offset.toString()];
}

/**
 * Format the import history title as per requirement
 * Example: flowlfex-14-08-2025-08:30pm
 * @param {Date} date
 * @returns {string}
 */
function formatImportHistoryTitle(date = new Date()) {
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60; // in minutes
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    const istDate = new Date(utc + istOffset * 60000);

    const day = String(istDate.getDate()).padStart(2, "0");
    const month = String(istDate.getMonth() + 1).padStart(2, "0");
    const year = istDate.getFullYear();
    const hours24 = istDate.getHours();
    const minutes = String(istDate.getMinutes()).padStart(2, "0");
    const ampm = hours24 >= 12 ? "pm" : "am";
    const hours12Raw = hours24 % 12;
    const hours12 = hours12Raw === 0 ? 12 : hours12Raw;
    const hours = String(hours12).padStart(2, "0");
    return `flowlfex-${day}-${month}-${year}-${hours}:${minutes}${ampm}`;
}

const updategcpBatchDetails = async (ctx, batchDetails, jobId, batchNumber, scheduledDate) => {
    try {
        console.log(`JobName:${jobId}`);
        const { broadcastId, type, batchCustomerCount } = batchDetails;
        console.log(batchDetails);
        const newBatchEntry = {
            batch_number: batchNumber,
            job_id: jobId,
            total_customers: batchCustomerCount,
            scheduled_at: scheduledDate,
            status: "pending",
            completed_at: null,
            channel_type: type,
        };
        await ctx.call("broadcast.findByIdAndUpdate", {
            id: broadcastId,
            data: {
                $push: { gcp_batches: newBatchEntry },
                $set: { status: "scheduled", updated_at: new Date() },
            }
        });
    } catch (error) {
        console.error(error);
        throw new Error("Failed to update broadcast status");
    }
};

function normalizeMongoOperators(obj) {
    if (Array.isArray(obj)) {
        return obj.map(normalizeMongoOperators);
    } else if (obj && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => {
                const newKey = key.startsWith("$") ? key.toLowerCase() : key;
                return [newKey, normalizeMongoOperators(value)];
            })
        );
    }
    return obj;
}

function getTierValue(tier) {
    let tierNumber = 0;
    if (tier === "TIER_50") {
        tierNumber = 50;
    } else if (tier === "TIER_250") {
        tierNumber = 250;
    } else if (tier === "TIER_1K") {
        tierNumber = 1000;
    } else if (tier === "TIER_10K") {
        tierNumber = 10000;
    } else if (tier === "TIER_100K") {
        tierNumber = 100000;
    } else if (tier === "TIER_UNLIMITED") {
        tierNumber = 1000000;
    }
    return tierNumber;
}

async function ExecuteCampaign(trigger_topic, payload, shop) {
    try {
        const projectId = process.env.GCP_PROJECT_ID;
        const location = process.env.GCP_LOCATION;
        console.log("shop:", shop);
        console.log("trigger_topic:", trigger_topic);
        const integration = await IntegrationModel.findOne({ "config.shop": shop });
        console.log("integration", integration);
        const campaigns = await CampaignModel.find({
            status: "Active",
            branch_id: integration?.branch_id,
        });
        if (!campaigns) {
            throw new Error("Campaigns not found");
        }
        console.log(`Found ${campaigns.length} active campaigns for topic: ${trigger_topic}`);
        for (const campaign of campaigns) {
            for (const flow of campaign.flows) {
                let triggerNode = flow?.fe_flow.nodes.find((node) => node.type === "triggerNode");
                if (triggerNode) {
                    console.log(`Triggering workflow for campaign: ${campaign.title}, flow: ${flow._id || "[no id]"}`);
                    const workflow = `Mainflow_${flow?._id.toString()}_${integration?.branch_id}`;
                    const createExecutionRes = await Executionclient.createExecution({
                        parent: Executionclient.workflowPath(projectId, location, workflow),
                        execution: {
                            argument: JSON.stringify(payload),
                        },
                    });
                    if (createExecutionRes && createExecutionRes.length > 0) {
                        const executionName = createExecutionRes[0]?.name;
                        console.log("info", `Created execution: ${executionName}`);
                    }
                } else {
                    console.log(`No trigger node found for campaign: ${campaign.title}, flow: ${flow._id || "[no id]"}`);
                }
            }
        }
    } catch (error) {
        console.error(error);
    }
}

/**
 * Converts a country name to its corresponding region code (ISO 3166-1 alpha-2)
 * 
 * This function uses a multi-layered approach:
 * 1. Exact matches with countries-list library
 * 2. Comprehensive alias mapping for common variations
 * 3. Partial matching for close matches
 * 4. Fuzzy matching as a fallback
 * 
 * Alternative: Consider using dedicated libraries like:
 * - 'iso-3166-1' for ISO country codes
 * - 'country-names' for country name variations
 * - 'fuse.js' for better fuzzy matching
 * 
 * @param {string} countryName - The country name (e.g., "United States", "India")
 * @returns {string|null} - The region code (e.g., "US", "IN") or null if not found
 */
function getCountryRegionCode(countryName) {
    if (!countryName || typeof countryName !== 'string') {
        return null;
    }

    // Normalize the country name for better matching
    const normalizedName = countryName.trim().toLowerCase();

    // First, try exact matches with the countries-list library
    for (const [code, country] of Object.entries(countryList.countries)) {
        // Check exact matches first
        if (country.name.toLowerCase() === normalizedName ||
            country.native.toLowerCase() === normalizedName) {
            return code.toUpperCase();
        }
    }

    // Create a comprehensive mapping of common variations and aliases
    const countryAliases = {
        // North America
        'usa': 'US', 'united states': 'US', 'united states of america': 'US', 'america': 'US',
        'canada': 'CA',
        'mexico': 'MX', 'mexico': 'MX',

        // Europe
        'uk': 'GB', 'united kingdom': 'GB', 'great britain': 'GB', 'england': 'GB', 'britain': 'GB',
        'germany': 'DE', 'deutschland': 'DE',
        'france': 'FR', 'republic of france': 'FR',
        'italy': 'IT', 'italia': 'IT',
        'spain': 'ES', 'espana': 'ES',
        'netherlands': 'NL', 'holland': 'NL',
        'belgium': 'BE',
        'switzerland': 'CH', 'schweiz': 'CH', 'suisse': 'CH',
        'austria': 'AT', 'osterreich': 'AT',
        'sweden': 'SE', 'sverige': 'SE',
        'norway': 'NO', 'norge': 'NO',
        'denmark': 'DK', 'danmark': 'DK',
        'finland': 'FI', 'suomi': 'FI',
        'poland': 'PL', 'polska': 'PL',
        'czech republic': 'CZ', 'czechia': 'CZ', 'cesko': 'CZ',
        'slovakia': 'SK', 'slovensko': 'SK',
        'hungary': 'HU', 'magyarorszag': 'HU',
        'romania': 'RO', 'romania': 'RO',
        'bulgaria': 'BG', 'bulgaria': 'BG',
        'greece': 'GR', 'hellas': 'GR',
        'portugal': 'PT',
        'ireland': 'IE', 'eire': 'IE',
        'iceland': 'IS', 'island': 'IS',

        // Asia
        'india': 'IN', 'bharat': 'IN', 'hindustan': 'IN',
        'china': 'CN', 'peoples republic of china': 'CN', 'prc': 'CN', 'zhongguo': 'CN',
        'japan': 'JP', 'nippon': 'JP', 'nihon': 'JP',
        'south korea': 'KR', 'republic of korea': 'KR', 'hanguk': 'KR',
        'north korea': 'KP', 'democratic peoples republic of korea': 'KP', 'choson': 'KP',
        'russia': 'RU', 'russian federation': 'RU', 'rossiya': 'RU',
        'thailand': 'TH', 'prathet thai': 'TH',
        'vietnam': 'VN', 'viet nam': 'VN',
        'indonesia': 'ID',
        'malaysia': 'MY',
        'singapore': 'SG',
        'philippines': 'PH', 'pilipinas': 'PH',
        'taiwan': 'TW', 'republic of china': 'TW',
        'hong kong': 'HK', 'xianggang': 'HK',
        'israel': 'IL', 'yisrael': 'IL',
        'saudi arabia': 'SA', 'al arabiya as saudiya': 'SA',
        'uae': 'AE', 'united arab emirates': 'AE',
        'turkey': 'TR', 'turkiye': 'TR',
        'iran': 'IR', 'persia': 'IR',
        'iraq': 'IQ',
        'afghanistan': 'AF',
        'pakistan': 'PK',
        'bangladesh': 'BD',
        'sri lanka': 'LK',
        'nepal': 'NP',
        'bhutan': 'BT',
        'myanmar': 'MM', 'burma': 'MM',
        'cambodia': 'KH', 'kampuchea': 'KH',
        'laos': 'LA', 'lao peoples democratic republic': 'LA',
        'mongolia': 'MN',
        'kazakhstan': 'KZ',
        'uzbekistan': 'UZ',
        'kyrgyzstan': 'KG',
        'tajikistan': 'TJ',
        'turkmenistan': 'TM',
        'azerbaijan': 'AZ',
        'georgia': 'GE', 'sakartvelo': 'GE',
        'armenia': 'AM', 'hayastan': 'AM',

        // Africa
        'south africa': 'ZA', 'rsa': 'ZA',
        'nigeria': 'NG',
        'egypt': 'EG', 'misr': 'EG',
        'kenya': 'KE',
        'ghana': 'GH',
        'uganda': 'UG',
        'tanzania': 'TZ',
        'ethiopia': 'ET',
        'morocco': 'MA', 'al maghrib': 'MA',
        'algeria': 'DZ', 'al jazair': 'DZ',
        'tunisia': 'TN',
        'libya': 'LY',
        'sudan': 'SD',
        'chad': 'TD',
        'niger': 'NE',
        'mali': 'ML',
        'burkina faso': 'BF', 'upper volta': 'BF',
        'senegal': 'SN',
        'guinea': 'GN',
        'sierra leone': 'SL',
        'liberia': 'LR',
        'ivory coast': 'CI', 'cote divoire': 'CI', 'cote d\'ivoire': 'CI',
        'benin': 'BJ', 'dahomey': 'BJ',
        'togo': 'TG',
        'cameroon': 'CM',
        'central african republic': 'CF', 'ubangi shari': 'CF',
        'equatorial guinea': 'GQ',
        'gabon': 'GA',
        'congo': 'CG', 'republic of congo': 'CG',
        'democratic republic of congo': 'CD', 'zaire': 'CD', 'congo kinshasa': 'CD',
        'angola': 'AO',
        'zambia': 'ZM', 'northern rhodesia': 'ZM',
        'zimbabwe': 'ZW', 'rhodesia': 'ZW',
        'botswana': 'BW', 'bechuanaland': 'BW',
        'namibia': 'NA', 'south west africa': 'NA',
        'lesotho': 'LS', 'basutoland': 'LS',
        'eswatini': 'SZ', 'swaziland': 'SZ',
        'madagascar': 'MG',
        'mauritius': 'MU',
        'seychelles': 'SC',
        'comoros': 'KM',
        'djibouti': 'DJ',
        'somalia': 'SO',
        'eritrea': 'ER',
        'south sudan': 'SS',

        // Oceania
        'australia': 'AU',
        'new zealand': 'NZ', 'aotearoa': 'NZ',
        'fiji': 'FJ',
        'papua new guinea': 'PG',
        'solomon islands': 'SB',
        'vanuatu': 'VU',
        'new caledonia': 'NC',
        'french polynesia': 'PF',

        // South America
        'brazil': 'BR', 'brasil': 'BR',
        'argentina': 'AR',
        'chile': 'CL',
        'peru': 'PE',
        'colombia': 'CO',
        'venezuela': 'VE',
        'ecuador': 'EC',
        'bolivia': 'BO',
        'paraguay': 'PY',
        'uruguay': 'UY',
        'guyana': 'GY',
        'suriname': 'SR',
        'french guiana': 'GF'
    };

    // Check aliases
    if (countryAliases[normalizedName]) {
        return countryAliases[normalizedName];
    }

    // If still no match, try partial matching
    for (const [alias, code] of Object.entries(countryAliases)) {
        if (alias.includes(normalizedName) || normalizedName.includes(alias)) {
            return code;
        }
    }

    // Finally, try fuzzy matching with the original countries-list data
    let bestMatch = null;
    let bestScore = 0;

    for (const [code, country] of Object.entries(countryList.countries)) {
        const countryNameLower = country.name.toLowerCase();
        const nativeNameLower = country.native.toLowerCase();

        // Calculate similarity scores
        const nameScore = calculateSimilarity(normalizedName, countryNameLower);
        const nativeScore = calculateSimilarity(normalizedName, nativeNameLower);
        const maxScore = Math.max(nameScore, nativeScore);

        if (maxScore > bestScore && maxScore > 0.8) { // Higher threshold for fuzzy matching
            bestScore = maxScore;
            bestMatch = code.toUpperCase();
        }
    }

    return bestMatch;
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score between 0 and 1
 */
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (str1.length === 0) return str2.length === 0 ? 1 : 0;
    if (str2.length === 0) return 0;

    const matrix = [];

    // Initialize matrix
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    // Calculate similarity score
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength === 0 ? 1 : (maxLength - matrix[str2.length][str1.length]) / maxLength;
}

/**
 * MongoDB Connection Health Check Utility
 * @param {Object} mongoose - Mongoose instance
 * @returns {Object} Connection status information
 */
function checkMongoDBHealth(mongoose) {
    if (!mongoose || !mongoose.connection) {
        return {
            status: 'disconnected',
            message: 'Mongoose not initialized',
            timestamp: new Date()
        };
    }

    const connection = mongoose.connection;
    const readyState = connection.readyState;

    let status, message;

    switch (readyState) {
        case 0:
            status = 'disconnected';
            message = 'MongoDB disconnected';
            break;
        case 1:
            status = 'connected';
            message = 'MongoDB connected';
            break;
        case 2:
            status = 'connecting';
            message = 'MongoDB connecting';
            break;
        case 3:
            status = 'disconnecting';
            message = 'MongoDB disconnecting';
            break;
        default:
            status = 'unknown';
            message = 'Unknown connection state';
    }

    return {
        status,
        message,
        readyState,
        host: connection.host,
        port: connection.port,
        name: connection.name,
        timestamp: new Date()
    };
}

/**
 * Wait for MongoDB connection to be ready
 * @param {Object} mongoose - Mongoose instance
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Promise<boolean>} True if connected, false if timeout
 */
function waitForMongoDBConnection(mongoose, timeout = 30000) {
    return new Promise((resolve) => {
        if (mongoose.connection.readyState === 1) {
            resolve(true);
            return;
        }

        const timeoutId = setTimeout(() => {
            mongoose.connection.removeListener('connected', onConnected);
            resolve(false);
        }, timeout);

        const onConnected = () => {
            clearTimeout(timeoutId);
            resolve(true);
        };

        mongoose.connection.once('connected', onConnected);
    });
}

module.exports = {
    comparePassword,
    FetchSharedWABAIDs,
    generateOtp,
    exchangeToken,
    FetchPhoneNumbers,
    ADDSystemUserToWABA,
    SubscribeAppToWaba,
    FormatPhoneNumber,
    getCountryRegionCode,
    CreateAggregation,
    CreateListAggregation,
    CreateSegmentAggregation,
    createRegexSearchQuery,
    getPageLimit,
    generateProjection,
    formatQuery,
    getTimeZoneFromOffset,
    updategcpBatchDetails,
    normalizeMongoOperators,
    ExecuteCampaign,
    formatImportHistoryTitle,
    checkMongoDBHealth,
    waitForMongoDBConnection
};
