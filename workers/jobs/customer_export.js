
const dotenv = require("dotenv");
dotenv.config();
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");
const { connectMongo } = require("../../models/init-db");
const { saveFileToCDN } = require("../../utils/cdn");
const os = require("os");
const fs = require("fs");
const { ObjectId } = require("mongodb");

const customerExportJob = async (job) => {
    try {
        const query = job.data || {};

        console.log(`🔄 Processing customer export job ${job.id}`);

        function logToFile(message) {
            const logDir = path.resolve(__dirname, "../logs");
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const logFilePath = path.join(logDir, `export-${new Date().toISOString().split("T")[0]}.log`);
            const timestamp = new Date().toISOString();
            fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
        }

        let _query = { ...query };
        
        // Remove job metadata fields from the MongoDB query
        delete _query.user_id;
        delete _query.user_image;

        // Update job progress
        await job.updateProgress(5);

        const db = await connectMongo();
        const customersCollection = db.collection("customers");
        const exportsCollection = db.collection("customerexports");
        logToFile("⚙️ ExportCsv started with query: " + JSON.stringify(_query));

        await job.updateProgress(10);

        const batchSize = 500;
        const tempFilePath = path.join(os.tmpdir(), `customers_${Date.now()}.csv`);
        logToFile("⚙️ Temp file path: " + tempFilePath);
        logToFile("⚙️ Batch size: " + batchSize);
        const csvHeader = [
            { id: "_id", title: "_id" },
            { id: "reference", title: "reference" },
            { id: "email", title: "email" },
            { id: "createdAt", title: "createdAt" },
            { id: "updatedAt", title: "updatedAt" },
            { id: "name", title: "name" },
            { id: "state", title: "state" },
            { id: "note", title: "note" },
            { id: "verified_email", title: "verified_email" },
            { id: "phone", title: "phone" },
            { id: "email_marketing_consent", title: "email_marketing_consent" },
            { id: "sms_marketing_consent", title: "sms_marketing_consent" },
            { id: "whatsapp_marketing_consent", title: "whatsapp_marketing_consent" },
            { id: "org_id", title: "org_id" },
            { id: "branch_id", title: "branch_id" },
            { id: "tags", title: "tags" }
        ];
        logToFile("⚙️ CSV Header: " + JSON.stringify(csvHeader));
        const csvWriter = createObjectCsvWriter({ path: tempFilePath, header: csvHeader });
        const isValidObjectId = (id) => /^[a-fA-F0-9]{24}$/.test(id);

        if (_query.branch_id && isValidObjectId(_query.branch_id)) {
            _query.branch_id = new ObjectId(_query.branch_id);
        }
        if (_query.org_id && isValidObjectId(_query.org_id)) {
            _query.org_id = new ObjectId(_query.org_id);
        }

        if (_query._id && _query._id.$in) {
            _query._id.$in = _query._id.$in
                .filter(isValidObjectId)
                .map(id => new ObjectId(id));
        }

        if (_query.lists && _query.lists.$in) {
            _query.lists.$in = _query.lists.$in
                .filter(isValidObjectId)
                .map(id => new ObjectId(id));
        }

        logToFile("⚙️ Query after ObjectId conversion: " + JSON.stringify(_query));

        await job.updateProgress(20);

        const totalDocuments = await customersCollection.countDocuments(_query);
        logToFile("⚙️ Total documents to export: " + totalDocuments);

        if (totalDocuments === 0) {
            logToFile("⚙️ No customer documents found.");
            await job.updateProgress(100);
            return {
                status: "Completed",
                fileurl: null,
                customer_count: 0
            };
        }

        let skip = 0;
        let totalcount = 0;
        let processedBatches = 0;
        const totalBatches = Math.ceil(totalDocuments / batchSize);

        await job.updateProgress(30);

        while (skip < totalDocuments) {
            logToFile(`⚙️ Fetching customer documents... ${JSON.stringify(_query)}, ${skip}, ${batchSize}`);
            const customerDocuments = await customersCollection.find(_query).skip(skip).limit(batchSize);
            const customerDocumentsArray = await customerDocuments.toArray();
            logToFile("⚙️ Customer documents fetched: " + customerDocumentsArray.length);
            totalcount += customerDocumentsArray.length;
            await csvWriter.writeRecords(customerDocumentsArray);
            skip += batchSize;
            processedBatches++;

            // Update progress based on batch processing
            const progress = 30 + Math.round((processedBatches / totalBatches) * 50);
            await job.updateProgress(progress);
        }

        logToFile("⚙️ CSV export completed. Total records: " + totalcount);

        await job.updateProgress(80);

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

        await job.updateProgress(90);

        const customerHistory = {
            createdAt: new Date(),
            branch_id: _query.branch_id,
            org_id: _query.org_id,
            status: "Completed",
            filecdn: fileurl,
            customer_count: totalcount,
            title: `flowflex-audience ${Date.now()}`
        };

        logToFile("⚙️ Customer history saved: " + JSON.stringify(customerHistory));
        await exportsCollection.insertOne(customerHistory);

        await job.updateProgress(100);
        logToFile("⚙️ ExportCsv completed successfully.");

        return {
            status: "Completed",
            fileurl,
            customer_count: totalcount
        };
    } catch (error) {
        console.error("Error in customer export job:", error);
        logToFile("❌ Export failed: " + error.message);
        throw error; // Re-throw the error so BullMQ can handle it properly
    }
};

module.exports = customerExportJob;
