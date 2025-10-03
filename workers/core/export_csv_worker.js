// workers/exportCsvWorker.js

const path = require("path");
const os = require("os");
const fs = require("fs");
const { createObjectCsvWriter } = require("csv-writer");
const dotenv = require("dotenv");
const workerpool = require("workerpool");
const { saveFileToCDN } = require("../../utils/cdn"); // Your GCP uploader // Your environment config
const { connectMongo } = require("../../models/init-db");
const { ObjectId } = require("mongodb");
const { CloudTasksClient } = require("@google-cloud/tasks");
const keyFilename = path.join(__dirname, "../gcp/service_account.json");
const Redis = require("ioredis");

dotenv.config();
const tasksClient = new CloudTasksClient({ keyFilename });
const redis = new Redis(process.env.REDIS_URI);

function logToFile(message) {
    const logDir = path.resolve(__dirname, "../logs");
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logFilePath = path.join(logDir, `export-${new Date().toISOString().split("T")[0]}.log`);
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
}

async function ExportCsv(query) {
    try {
        let _query = query || {};
        const db = await connectMongo();
        const customersCollection = db.collection("customers");
        const exportsCollection = db.collection("customerexports");
        logToFile("⚙️ ExportCsv started with query: " + JSON.stringify(_query));
        const batchSize = 500;
        const tempFilePath = path.join(os.tmpdir(), `customers_${Date.now()}.csv`);
        logToFile("⚙️ Temp file path: " + tempFilePath);
        logToFile("⚙️ Batch size: " + batchSize);
        const csvHeader = [
            { id: "_id", title: "_id" },
            { id: "reference", title: "reference" },
            { id: "email", title: "email" },
            { id: "created_at", title: "created_at" },
            { id: "updated_at", title: "updated_at" },
            { id: "name", title: "name" },
            { id: "order_count", title: "order_count" },
            { id: "state", title: "state" },
            { id: "note", title: "note" },
            { id: "verified_email", title: "verified_email" },
            { id: "phone", title: "phone" },
            { id: "email_marketing_consent", title: "email_marketing_consent" },
            { id: "sms_marketing_consent", title: "sms_marketing_consent" },
            { id: "whatsapp_marketing_consent", title: "whatsapp_marketing_consent" },
            { id: "org_id", title: "org_id" },
            { id: "branch_id", title: "branch_id" },
            { id: "cursor", title: "cursor" },
            { id: "tags", title: "tags" }
        ];
        logToFile("⚙️ CSV Header: " + JSON.stringify(csvHeader));
        const csvWriter = createObjectCsvWriter({ path: tempFilePath, header: csvHeader });
        const isValidObjectId = (id) => /^[a-fA-F0-9]{24}$/.test(id);

        if (_query.branch_id && isValidObjectId(_query.branch_id)) {
            _query.branch_id = ObjectId.createFromHexString(_query.branch_id);
        }
        if (_query.org_id && isValidObjectId(_query.org_id)) {
            _query.org_id = ObjectId.createFromHexString(_query.org_id);
        }

        if (_query._id && _query._id.$in) {
            _query._id.$in = _query._id.$in
                .filter(isValidObjectId)
                .map(id => ObjectId.createFromHexString(id));
        }

        if (_query._list) {
            _query._list.$in = _query._list.$in
                .filter(isValidObjectId)
                .map(id => ObjectId.createFromHexString(id));
        }

        logToFile("⚙️ Query after ObjectId conversion: " + JSON.stringify(_query));

        if (totalcount === 0) {
            logToFile("⚙️ No customer documents found.");
            return {
                status: "Completed",
                fileurl: null,
                customer_count: 0
            };
        }

        const totalDocuments = await customersCollection.countDocuments(_query);
        logToFile("⚙️ Total documents to export: " + totalDocuments);
        let skip = 0;
        let totalcount = 0;

        while (skip <= totalDocuments) {
            logToFile(`⚙️ Fetching customer documents... ${JSON.stringify(_query)}, ${skip}, ${batchSize}`);
            const customerDocuments = await customersCollection.find(_query).skip(skip).limit(batchSize);
            const customerDocumentsArray = await customerDocuments.toArray();
            logToFile("⚙️ Customer documents fetched: " + customerDocumentsArray.length);
            totalcount += customerDocumentsArray.length;
            await csvWriter.writeRecords(customerDocumentsArray);
            skip += batchSize;
        }

        logToFile("⚙️ CSV export completed. Total records: " + totalcount);


        const fileContent = fs.readFileSync(tempFilePath);
        const filename = `customers_${Date.now()}.csv`;

        logToFile("⚙️ File content length: " + fileContent.length);
        logToFile("⚙️ File name: " + filename);

        const fileurl = await saveFileToCDN(
            filename,
            fileContent,
            "offline-reviewbit/customer_exports",
            "text/csv",
            process.env.GCP_BUCKET ?? ""
        );

        logToFile("⚙️ File URL: " + fileurl);

        fs.unlinkSync(tempFilePath);

        const customerHistory = {
            created_at: new Date(),
            branch_id: _query.branch_id,
            org_id: _query.org_id,
            status: "Completed",
            filecdn: fileurl,
            customer_count: totalcount,
            title: `flowflex-audience ${Date.now()}`
        };

        logToFile("⚙️ Customer history saved: " + JSON.stringify(customerHistory));
        await exportsCollection.insertOne(customerHistory);

        logToFile("⚙️ ExportCsv completed successfully.");

        return {
            status: "Completed",
            fileurl,
            customer_count: totalcount
        };
    } catch (error) {
        console.log("Error in ExportCsv:sds");
        return {
            status: "Failed",
            error: error.message
        };
    }

}

async function updateCustomers(action, query, data) {
    try {
        let _query = query || {};
        const db = await connectMongo();
        const customersCollection = db.collection("customers");
        const listsCollection = db.collection("lists");
        let modifiedCount = 0;

        const isValidObjectId = (id) => /^[a-fA-F0-9]{24}$/.test(id);

        if (_query.branch_id && isValidObjectId(_query.branch_id)) {
            _query.branch_id = ObjectId.createFromHexString(_query.branch_id);
        }
        if (_query.org_id && isValidObjectId(_query.org_id)) {
            _query.org_id = ObjectId.createFromHexString(_query.org_id);
        }


        if (_query._id && _query._id.$in) {
            _query._id.$in = _query._id.$in
                .filter(isValidObjectId)
                .map(id => ObjectId.createFromHexString(id));
        }

        logToFile("⚙️ Query after ObjectId conversion: " + JSON.stringify(_query));

        let totalDocuments = await customersCollection.countDocuments(_query);
        logToFile("⚙️ Total documents to update: " + totalDocuments);
        logToFile("⚙️ Action: " + JSON.stringify(action));

        let actiontype = {
            subscribe_to_whatsapp: {
                $set: { whatsapp_marketing_consent: true, sms_marketing_consent: true, email_marketing_consent: true, updated_at: new Date() },
            },
            unsubscribe_to_whatsapp: {
                $set: { whatsapp_marketing_consent: false, sms_marketing_consent: false, email_marketing_consent: false, updated_at: new Date() },
            },
            subscribe_to_sms: { $set: { sms_marketing_consent: true, updated_at: new Date() } },
            unsubscribe_to_sms: {
                $set: { sms_marketing_consent: false, updated_at: new Date() },
            },
            subscribe_to_email: {
                $set: { email_marketing_consent: true, updated_at: new Date() },
            },
            unsubscribe_to_email: {
                $set: { email_marketing_consent: false, updated_at: new Date() },
            },
            subscribe: {
                $set: {
                    sms_marketing_consent: true,
                    whatsapp_marketing_consent: true,
                    email_marketing_consent: true,
                    updated_at: new Date(),
                },
            },
            unsubscribe: {
                $set: {
                    sms_marketing_consent: false,
                    whatsapp_marketing_consent: false,
                    email_marketing_consent: false,
                    updated_at: new Date(),
                },
            },
            add_tag: {
                $addToSet: {
                    tags: {
                        $each: data.map((e) => isValidObjectId(e) ? ObjectId.createFromHexString(e) : e)
                    }
                },
                $set: { updated_at: new Date() }
            },
            remove_tag: {
                $pull: {
                    tags: {
                        $in: data.map((e) => isValidObjectId(e) ? ObjectId.createFromHexString(e) : e),
                    },
                },
                $set: { updated_at: new Date() },
            },
            add_to_list: {
                $addToSet: {
                    lists: {
                        $each: data.map((e) => isValidObjectId(e) ? ObjectId.createFromHexString(e) : e)
                    }
                },
                $set: { updated_at: new Date() }
            },
            export: {},
        };
        let updateResult = { modifiedCount: 0 };

        if (action === "delete") {
            await customersCollection.deleteMany(
                _query
            );
            // No updateMany needed for delete
        } else {
            updateResult = await customersCollection.updateMany(
                _query,
                actiontype[action]
            );
            if (action === "add_to_list") {
                await listsCollection.updateMany(
                    { _id: { $in: data.map((e) => isValidObjectId(e) ? ObjectId.createFromHexString(e) : e) } },
                    { $set: { updatedAt: new Date() } }
                );
            }
        }

        modifiedCount = updateResult.modifiedCount;

        return modifiedCount;
    } catch (error) {
        throw error;
    }
}

async function scheduleBroadcasts({
    cronJobName,
    broadcastId,
    template_id,
    template_json,
    org_id,
    branch_id,
    title,
    type,
    audience_category,
    cate_ref,
    batchCustomerCount,
    offset,
    limit,
    batchNumber,
    channel
}) {
    console.log(
        `broadcastID:${broadcastId}, templateID:${template_id}, template_json:${template_json}, organisation:${org_id}, branch_id:${branch_id}, title:${title}, type:${title}, audience_category:${audience_category}, cate_ref:${cate_ref}, batchCustomerCount:${batchCustomerCount}, offset:${offset}, limit:${limit}`
    );
    const db = await connectMongo();
    const customersCollection = db.collection("customers");
    const customersSegmentCollection = db.collection("Segments");
    const broadcastCollection = db.collection("broadcasts");
    const API_DELAY = 2000;
    let customers = [];
    let hasStartedProcessing = false;

    if (audience_category === "list") {
        customers = await customersCollection
            .find({ lists: { $in: [new ObjectId(cate_ref)] } })
            .skip(offset)
            .limit(limit)
            .toArray();
        console.log(customers.length, "customers found in list");
    } else if (audience_category === "segment") {
        const segment = await customersSegmentCollection.findOne({ _id: new ObjectId(cate_ref) });
        if (!segment) {
            console.log("Segment not found");
            return;
        }
        const { rules } = segment;
        let query;
        query = JSON.parse(rules);
        query.org_id = org_id;
        customers = await customersCollection.find(query).skip(offset).limit(limit).toArray();
    }

    for (let j = 0; j < customers.length; j++) {
        const customer = customers[j];
        console.log(`Processing customer ${j + 1}/${customers.length}: ${customer._id}`);
        const customerPhoneNumber = customer.phone;
        if (!hasStartedProcessing) {
            await updateBroadcastStatus(broadcastId, "active");
            hasStartedProcessing = true;
            console.log("Broadcast status set to processing");
        }
        const alreadysent = await redis.get(`broadcastsent:${broadcastId}:${customerPhoneNumber}`);
        if (alreadysent) {
            console.log(`Message already sent to ${customerPhoneNumber} for broadcast ${broadcastId}`);
        } else {
            sendMessageToCustomer(customerPhoneNumber, template_id, template_json, org_id, branch_id, broadcastId, title, cate_ref, customer._id, channel?.waba_id);
            await redis.set(`broadcastsent:${broadcastId}:${customerPhoneNumber}`, "sent", "EX", 24 * 60 * 60); // Set to expire in 24 hours

        }
        if (j < customers.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, API_DELAY));
        }
    }
    const updateResult = await broadcastCollection
        .aggregate([
            {
                $match: {
                    _id: new ObjectId(broadcastId),
                },
            },
            {
                $set: {
                    gcp_batches: {
                        $map: {
                            input: "$gcp_batches",
                            as: "batch",
                            in: {
                                $cond: {
                                    if: { $eq: ["$$batch.job_id", cronJobName] },
                                    then: {
                                        $mergeObjects: [
                                            "$$batch",
                                            {
                                                status: "completed",
                                                completed_at: new Date(),
                                            },
                                        ],
                                    },
                                    else: "$$batch",
                                },
                            },
                        },
                    },
                    updated_at: new Date(),
                },
            },
            {
                $merge: { into: "broadcasts", whenMatched: "replace" },
            },
        ])
        .toArray();

    const broadcast = await broadcastCollection.findOne({ _id: new ObjectId(broadcastId), org_id: org_id, branch_id: branch_id });
    console.log("findone:", broadcast);
    if (!broadcast) {
        throw new Error(`Broadcast with ID ${broadcastId} not found.`);
    }
    const allBatchesCompleted = broadcast.gcp_batches.every((batch) => batch.status === "completed");
    console.log(`All batches completed: ${allBatchesCompleted}`);

    if (allBatchesCompleted) {
        await updateBroadcastStatus(broadcastId, "completed");
        console.log(`Broadcast ${broadcastId} is now marked as completed`);
    }

    // await ctx.call("gcp.deleteJob", { cronJobName });
}

const updateBroadcastStatus = async (broadcastId, status) => {
    try {
        const db = await connectMongo();
        const broadcastCollection = db.collection("broadcasts");
        const broadcast = await broadcastCollection.findOneAndUpdate({ _id: new ObjectId(broadcastId) }, { $set: { status: status } }, { returnDocument: "after" });

        if (!broadcast) {
            throw new Error(`Broadcast with ID ${broadcastId} not found.`);
        }
        return broadcast.value;
    } catch (error) {
        console.log("Error updating broadcast status");
        console.error(error);
        throw new Error("Failed to update broadcast status");
    }
};

const sendMessageToCustomer = async (
    customerPhone,
    template_id,
    meta_payload,
    org_id,
    branch_id,
    broadcastId,
    title,
    category_id,
    customer_id,
    waba_id
) => {
    try {
        const data = {
            message_type: "template",
            branch_id: branch_id,
            org_id: org_id,
            body: JSON.stringify(meta_payload),
            to: customerPhone,
            flow_id: broadcastId,
            workflowTitle: title,
            form_payload: {},
            isBroadcast: true,
            category_id: category_id,
            customer_id: customer_id,
            waba_id: waba_id,
        };
        createTask(data);
    } catch (error) {
        console.log(`Error sending message to ${customerPhone}`);
        console.error(error);
    }
};

const createTask = async (data) => {
    try {
        console.log(`Project ID: ${process.env.GCP_PROJECT_ID}, Location: ${process.env.BROADCAST_QUEUE_LOCATION}, Queue: ${process.env.BROADCAST_QUEUE}`);

        const queuePath = tasksClient.queuePath(
            process.env.GCP_PROJECT_ID ?? "",
            process.env.BROADCAST_QUEUE_LOCATION ?? "",
            process.env.BROADCAST_QUEUE ?? ""
        );

        // Construct full URL with query parameters
        let taskUrl = process.env.WHATSAPP_SEND_UTIL;

        const task = {
            httpRequest: {
                httpMethod: "POST",
                url: taskUrl,
                body: Buffer.from(JSON.stringify(data)),
                headers: {
                    "Content-Type": "application/json",
                },
            },
        };

        const request = { parent: queuePath, task };
        const [response] = await tasksClient.createTask(request);

        console.log(`Created task with ID: ${response.name}`);
    } catch (error) {
        console.error("Failed to create Cloud Task:", error);
    }
};

workerpool.worker({
    ExportCsv: ExportCsv,
    updateCustomers: updateCustomers,
    scheduleBroadcasts: scheduleBroadcasts,
}, {
    onTerminate: (code) => {
        console.log("Worker terminated", code);
    },
});

module.exports = { ExportCsv, updateCustomers, scheduleBroadcasts };
