const { Worker } = require("bullmq");
const Redis = require("ioredis");
const dotenv = require("dotenv");
const { ServiceBroker } = require("moleculer");
const path = require("path");
const axios = require("axios");
const csvParser = require("csv-parser");
const fs = require("fs");
const { ObjectId } = require("mongodb");
const { connectMongo } = require("../../mixins/db");
const { FormatPhoneNumber, getCountryRegionCode, formatImportHistoryTitle } = require("../../utils/common");

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

const broker = new ServiceBroker({
    logger: console,
    nodeID: `customer-import-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER,
});

console.log('Transporter: customer-import-worker', process.env.TRANSPORTER);

// Load only what we need for notifications
const projectRoot = path.resolve(__dirname, "..");
broker.loadService(path.join(projectRoot, "../services/utility/notification.service.js"));
broker.loadService(path.join(projectRoot, "../services/integration/gcp.service.js"));
broker.loadService(path.join(projectRoot, "../services/integration/supabase.service.js"));

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
    await broker.start();

    const worker = new Worker("customer-import", async (job) => {
        const { cdnfile, column, targetList, branch_id, org_id, importId } = job.data || {};

        if (!cdnfile || !Array.isArray(column) || !branch_id || !org_id) {
            throw new Error("Invalid job payload for customer-import");
        }

        const BATCH_SIZE = 1000;
        let insertedCount = 0;
        const errors = [];
        const erroredRows = [];

        function validateEmail(email) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
        }

        function trimRowKeys(row) {
            const out = {};
            for (const [k, v] of Object.entries(row)) out[(k || "").trim()] = (v || "").toString().trim();
            return out;
        }

        const db = await connectMongo();
        const customersCollection = db.collection("customers");
        const customerImportsCollection = db.collection("customerimports");

        async function insertBatch(docs) {
            if (!docs.length) return 0;
            const options = { ordered: false };
            let validDocs = [];
            for (const doc of docs) {
                let formattedPhone = FormatPhoneNumber(doc.phone);
                if (!formattedPhone && doc.country) {
                    const regionCode = getCountryRegionCode(doc.country);
                    if (regionCode) formattedPhone = FormatPhoneNumber(doc.phone, regionCode);
                }
                if (formattedPhone) {
                    validDocs.push({
                        reference: doc.reference || "",
                        email: doc.email || null,
                        name: doc.name || "",
                        country: doc.country || "",
                        lists: targetList ? [new ObjectId(targetList)] : (doc.lists ? doc.lists.map(id => new ObjectId(id)) : []),
                        state: doc.state || "",
                        note: doc.note || "",
                        verified_email: doc.verified_email !== undefined ? doc.verified_email : false,
                        tags: Array.isArray(doc.tags) ? doc.tags.map(id => new ObjectId(id)) : [],
                        phone: formattedPhone,
                        addresses: doc.addresses || [],
                        tax_exemptions: doc.tax_exemptions || [],
                        email_marketing_consent: doc.email_marketing_consent !== undefined ? doc.email_marketing_consent : true,
                        sms_marketing_consent: doc.sms_marketing_consent !== undefined ? doc.sms_marketing_consent : true,
                        whatsapp_marketing_consent: doc.whatsapp_marketing_consent !== undefined ? doc.whatsapp_marketing_consent : true,
                        org_id: new ObjectId(org_id),
                        branch_id: new ObjectId(branch_id),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                }
                else {
                    errors.push("Invalid phone number");
                    erroredRows.push({ ...doc, error: "Invalid phone number" });
                }
            }
            if (validDocs.length === 0) return 0;
            try {
                const result = await customersCollection.insertMany(validDocs, options);
                return result && result.insertedIds ? Object.keys(result.insertedIds).length : 0;
            } catch (error) {
                if (error && Array.isArray(error.writeErrors) && error.writeErrors.length > 0) {
                    for (const writeErr of error.writeErrors) {
                        console.log("writeErr", writeErr.err);
                        let errMsg;
                        if (writeErr.err && writeErr.err.code === 11000) {
                            errMsg = "This contact already exists";
                        } else {
                            errMsg = (writeErr && (writeErr.err?.errmsg || writeErr.err?.message || writeErr.message)) || (error.message || "Unknown bulk write error");
                        }
                        errors.push(errMsg);
                        // Try to map the error index back to the original doc to include in erroredRows CSV
                        try {
                            const idx = (writeErr && (writeErr.err?.index ?? writeErr.index));
                            if (typeof idx === "number" && validDocs[idx]) {
                                erroredRows.push({ ...validDocs[idx], error: errMsg });
                            }
                        } catch (_) { }
                    }
                    return Math.max(validDocs.length - error.writeErrors.length, 0);
                }
                errors.push(error.message || JSON.stringify(error));
                throw error;
            }
        }

        const timestamp = Date.now();
        const pendingDocs = [];

        await new Promise(async (resolve, reject) => {
            try {
                const response = await axios.get(cdnfile, { responseType: "stream" });
                const parser = csvParser();
                response.data.pipe(parser);

                parser.on("data", async (rawRow) => {
                    try {
                        const row = trimRowKeys(rawRow);
                        const customer = {};
                        let hasValidContact = false;

                        for (const e of column) {
                            const importedValue = (row[e.imported_headers] || "");
                            switch (e.profile_headers) {
                                case "order_count":
                                    customer[e.profile_headers] = parseInt(importedValue) || 0;
                                    break;
                                case "email_marketing_consent":
                                case "sms_marketing_consent":
                                case "whatsapp_marketing_consent":
                                    customer[e.profile_headers] = importedValue.toUpperCase() === "TRUE";
                                    break;
                                case "email":
                                    if (importedValue && validateEmail(importedValue)) {
                                        customer[e.profile_headers] = importedValue;
                                        // hasValidContact = true;
                                    }
                                    break;
                                case "phone": {
                                    let phone = importedValue.replace(/\s+/g, "");
                                    if (phone) {
                                        customer[e.profile_headers] = phone;
                                        hasValidContact = true;
                                    }
                                    break;
                                }
                                case "country":
                                    if (typeof importedValue === "string" && importedValue.length > 0) customer[e.profile_headers] = importedValue;
                                    break;
                                default:
                                    customer[e.profile_headers] = importedValue;
                                    break;
                            }
                        }

                        if (!hasValidContact) {
                            const errorMessage = "Invalid contact information: Email and Phone are both invalid for row";
                            errors.push(errorMessage);
                            erroredRows.push({ ...row, error: errorMessage });
                            return;
                        }

                        customer.org_id = org_id;
                        customer.reference = timestamp.toString();
                        customer.branch_id = branch_id;

                        pendingDocs.push(customer);
                        if (pendingDocs.length >= BATCH_SIZE) {
                            parser.pause();
                            const batch = pendingDocs.splice(0, BATCH_SIZE);
                            const count = await insertBatch(batch);
                            insertedCount += count;
                            if ((process.env.NODE_ENV || "").toLowerCase() === "development") {
                                // const delayMs = Number(process.env.CUSTOMER_IMPORT_DEV_DELAY_MS || 0);
                                // if (delayMs > 0) {
                                //     await sleep(delayMs);
                                // }
                            }
                            if (importId) {
                                try {
                                    await customerImportsCollection.updateOne(
                                        { _id: new ObjectId(importId) },
                                        {
                                            $set: {
                                                customer_count: insertedCount,
                                                updatedAt: new Date(),
                                            }
                                        }
                                    );
                                } catch (e) {
                                    // ignore progress update errors
                                }
                            }
                            parser.resume();
                        }
                    } catch (err) {
                        errors.push(err.message || JSON.stringify(err));
                    }
                });

                parser.on("error", (error) => {
                    errors.push(error.message);
                });

                parser.on("end", async () => {
                    try {
                        if (pendingDocs.length > 0) {
                            const count = await insertBatch(pendingDocs.splice(0, pendingDocs.length));
                            insertedCount += count;
                        }
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });

        let errorcdnlink = "";
        if (erroredRows.length > 0) {
            try {
                const errorDir = path.resolve(__dirname, "../../services/customer");
                const erroredRowsFilePath = path.join(errorDir, `errored_rows_${timestamp}.csv`);
                const headerRow = column.map((e) => e.imported_headers).join(",") + ",error";
                const erroredRowsCsv = erroredRows.map((row) => {
                    const rowData = column.map((e) => row[e.imported_headers] || "").join(",");
                    return `${rowData},${row.error}`;
                }).join("\n");
                const completeCsv = `${headerRow}\n${erroredRowsCsv}`;
                fs.writeFileSync(erroredRowsFilePath, completeCsv);
                const result = await broker.call("gcp.uploadFile", {
                    bucket: process.env.GCP_BUCKET,
                    filename: `errored_rows_${timestamp}.csv`,
                    buffer: fs.readFileSync(erroredRowsFilePath),
                    contentType: "text/csv"
                });
                errorcdnlink = result?.url;
                fs.unlink(erroredRowsFilePath, (err) => {
                    if (err) {
                        console.error("Error deleting errored rows file:", err);
                    }
                });
            } catch (err) {
                console.log("err", err);
                errors.push(err.message || JSON.stringify(err));
            }
        }

        if (importId) {
            try {
                await customerImportsCollection.updateOne(
                    { _id: new ObjectId(importId) },
                    {
                        $set: {
                            status: "Completed",
                            customer_count: insertedCount,
                            errorcdn: errorcdnlink,
                            updatedAt: new Date(),
                        }
                    }
                );
            } catch (e) {
                await customerImportsCollection.insertOne({
                    branch_id,
                    org_id,
                    title: formatImportHistoryTitle(new Date()),
                    filecdn: cdnfile,
                    status: "Completed",
                    customer_count: insertedCount,
                    errorcdn: errorcdnlink,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
            }
        } else {
            await customerImportsCollection.insertOne({
                branch_id,
                org_id,
                title: formatImportHistoryTitle(new Date()),
                filecdn: cdnfile,
                status: "Completed",
                customer_count: insertedCount,
                errorcdn: errorcdnlink,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }

        const totalProcessed = insertedCount + erroredRows.length;
        try {
            await broker.call("notification.send", {
                templateKey: "customer_import_completed",
                variables: { count: insertedCount, total: totalProcessed },
                additionalData: { organisation_id: org_id, branch_id },
            });
        } catch (notifyErr) {
            // ignore
        }

        return { insertedCount, totalProcessed, errorsCount: errors.length, errorFile: errorcdnlink };
    }, {
        connection,
        autorun: true,
        concurrency: 2,
    });

    worker.on("completed", (job, result) => {
        console.log(`🎉 Customer import job ${job.id} completed:`, result);
    });

    worker.on("failed", (job, err) => {
        console.error(`❌ Customer import job ${job?.id} failed:`, err?.message || err);
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
        console.log("\n🛑 Shutting down customer import worker gracefully...");
        await worker.close();
        await broker.stop();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        console.log("\n🛑 Shutting down customer import worker gracefully...");
        await worker.close();
        await broker.stop();
        process.exit(0);
    });
})();

// Export a handle to satisfy workers.service close() calls
module.exports = {
    close: async () => {
        try { await broker.stop(); } catch (e) { }
    }
};
