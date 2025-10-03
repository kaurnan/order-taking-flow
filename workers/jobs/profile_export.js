const path = require("path");
const os = require("os");
const fs = require("fs");
const { createObjectCsvWriter } = require("csv-writer");
const dotenv = require("dotenv");
const { saveFileToCDN } = require("../../utils/cdn");
const { connectMongo } = require("../../models/init-db");
const { ObjectId } = require("mongodb");
const ExcelJS = require("exceljs");

dotenv.config();

function logToFile(message, exportId = "unknown") {
    const logDir = path.resolve(__dirname, "../logs");
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logFilePath = path.join(logDir, `profile-export-${new Date().toISOString().split("T")[0]}.log`);
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFilePath, `[${timestamp}] [Export: ${exportId}] ${message}\n`);
}

const profileExportJob = async (job) => {
    try {
        const {
            exportId,
            query,
            exportType,
            fields,
            title,
            includeTags,
            includeLists,
            includeMetadata,
            orgId,
            branchId
        } = job.data || {};

        console.log(`🔄 Processing profile export job ${job.id} for export: ${exportId}`);
        logToFile("🚀 Profile export started", exportId);

        // Update job progress
        await job.updateProgress(5);

        const db = await connectMongo();
        const customersCollection = db.collection("customers");
        const profileExportsCollection = db.collection("profileexports");
        const tagsCollection = db.collection("tags");
        const listsCollection = db.collection("lists");

        // Update export status to processing
        await profileExportsCollection.updateOne(
            { _id: new ObjectId(exportId) },
            {
                $set: {
                    status: "processing",
                    started_at: new Date()
                }
            }
        );

        await job.updateProgress(10);
        logToFile("📊 Fetching customer data", exportId);

        // Convert string IDs to ObjectId
        const processedQuery = processQueryIds(query);

        // Get total count
        const totalDocuments = await customersCollection.countDocuments(processedQuery);
        logToFile(`📈 Total customers to export: ${totalDocuments}`, exportId);

        if (totalDocuments === 0) {
            await profileExportsCollection.updateOne(
                { _id: new ObjectId(exportId) },
                {
                    $set: {
                        status: "failed",
                        error_message: "No customers found matching the criteria",
                        completed_at: new Date()
                    }
                }
            );
            return { status: "failed", error: "No customers found" };
        }

        // Prepare export data
        const exportData = [];
        const batchSize = 1000;
        let skip = 0;
        let processedCount = 0;

        await job.updateProgress(15);

        while (skip < totalDocuments) {
            logToFile(`🔄 Processing batch ${Math.floor(skip / batchSize) + 1}`, exportId);

            const customers = await customersCollection
                .find(processedQuery)
                .skip(skip)
                .limit(batchSize)
                .toArray();

            // Process each customer
            for (const customer of customers) {
                const processedCustomer = await processCustomerData(
                    customer,
                    fields,
                    includeTags,
                    includeLists,
                    includeMetadata,
                    tagsCollection,
                    listsCollection
                );
                exportData.push(processedCustomer);
                processedCount++;
            }

            // Update progress
            await profileExportsCollection.updateOne(
                { _id: new ObjectId(exportId) },
                {
                    $set: {
                        processed_count: processedCount,
                        progress_percentage: Math.round((processedCount / totalDocuments) * 100)
                    }
                }
            );

            // Update job progress based on processing
            const progress = 15 + Math.round((processedCount / totalDocuments) * 60);
            await job.updateProgress(progress);

            skip += batchSize;
        }

        logToFile(`✅ Data processing completed. Total records: ${exportData.length}`, exportId);

        await job.updateProgress(80);

        // Generate export file
        let fileUrl, fileSize;

        switch (exportType) {
            case "csv":
                ({ fileUrl, fileSize } = await exportToCSV(exportData, fields, title, exportId));
                break;
            case "json":
                ({ fileUrl, fileSize } = await exportToJSON(exportData, title, exportId));
                break;
            case "xlsx":
                ({ fileUrl, fileSize } = await exportToXLSX(exportData, fields, title, exportId));
                break;
            default:
                throw new Error(`Unsupported export type: ${exportType}`);
        }

        await job.updateProgress(90);

        // Update export record as completed
        await profileExportsCollection.updateOne(
            { _id: new ObjectId(exportId) },
            {
                $set: {
                    status: "completed",
                    file_url: fileUrl,
                    file_size: fileSize,
                    completed_at: new Date(),
                    progress_percentage: 100,
                    processed_count: totalDocuments
                }
            }
        );

        await job.updateProgress(100);
        logToFile(`🎉 Export completed successfully. File: ${fileUrl}`, exportId);

        return {
            status: "completed",
            fileUrl,
            fileSize,
            recordCount: exportData.length,
            exportId
        };

    } catch (error) {
        console.error("Error in profile export job:", error);
        logToFile(`❌ Export failed: ${error.message}`, exportId);

        // Update export record as failed
        try {
            const db = await connectMongo();
            const profileExportsCollection = db.collection("profileexports");

            await profileExportsCollection.updateOne(
                { _id: new ObjectId(exportId) },
                {
                    $set: {
                        status: "failed",
                        error_message: error.message,
                        completed_at: new Date()
                    }
                }
            );
        } catch (updateError) {
            console.error("Failed to update export status:", updateError);
        }

        throw error; // Re-throw the error so BullMQ can handle it properly
    }
};

// Helper functions (these would need to be implemented or imported)
async function processCustomerData(customer, fields, includeTags, includeLists, includeMetadata, tagsCollection, listsCollection) {
    const processedCustomer = {};

    // Process basic fields
    for (const field of fields) {
        if (field === "_id") {
            processedCustomer[field] = customer[field]?.toString();
        } else if (customer.hasOwnProperty(field)) {
            processedCustomer[field] = customer[field];
        } else {
            processedCustomer[field] = "";
        }
    }

    // Process tags if included
    if (includeTags && customer.tags && customer.tags.length > 0) {
        const tagIds = customer.tags.map(tag => new ObjectId(tag));
        const tags = await tagsCollection.find({ _id: { $in: tagIds } }).toArray();
        processedCustomer.tags = tags.map(tag => tag.name).join(", ");
    }

    // Process lists if included
    if (includeLists && customer.lists && customer.lists.length > 0) {
        const listIds = customer.lists.map(list => new ObjectId(list));
        const lists = await listsCollection.find({ _id: { $in: listIds } }).toArray();
        processedCustomer.lists = lists.map(list => list.title).join(", ");
    }

    // Process metadata if included
    if (includeMetadata) {
        processedCustomer.created_at = customer.created_at;
        processedCustomer.updated_at = customer.updated_at;
    }

    return processedCustomer;
}

function processQueryIds(query) {
    const processedQuery = { ...query };

    if (processedQuery.branch_id && typeof processedQuery.branch_id === "string") {
        processedQuery.branch_id = new ObjectId(processedQuery.branch_id);
    }
    if (processedQuery.org_id && typeof processedQuery.org_id === "string") {
        processedQuery.org_id = new ObjectId(processedQuery.org_id);
    }
    if (processedQuery._id && processedQuery._id.$in) {
        processedQuery._id.$in = processedQuery._id.$in.map(id => new ObjectId(id));
    }

    return processedQuery;
}

async function exportToCSV(exportData, fields, title, exportId) {
    const tempFilePath = path.join(os.tmpdir(), `profile_export_${Date.now()}.csv`);

    const csvWriter = createObjectCsvWriter({
        path: tempFilePath,
        header: fields.map(field => ({
            id: field,
            title: field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ')
        }))
    });

    await csvWriter.writeRecords(exportData);

    const fileUrl = await saveFileToCDN(
        tempFilePath,
        `profile_exports/${exportId}_${Date.now()}.csv`,
        "offline-reviewbit/profile_exports",
        "text/csv"
    );

    const fileSize = fs.statSync(tempFilePath).size;
    fs.unlinkSync(tempFilePath);

    return { fileUrl, fileSize };
}

async function exportToJSON(exportData, title, exportId) {
    const tempFilePath = path.join(os.tmpdir(), `profile_export_${Date.now()}.json`);

    const jsonData = {
        title,
        exportDate: new Date().toISOString(),
        recordCount: exportData.length,
        data: exportData
    };

    fs.writeFileSync(tempFilePath, JSON.stringify(jsonData, null, 2));

    const fileUrl = await saveFileToCDN(
        tempFilePath,
        `profile_exports/${exportId}_${Date.now()}.json`,
        "offline-reviewbit/profile_exports",
        "application/json"
    );

    const fileSize = fs.statSync(tempFilePath).size;
    fs.unlinkSync(tempFilePath);

    return { fileUrl, fileSize };
}

async function exportToXLSX(exportData, fields, title, exportId) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Profile Export");

    // Add headers
    worksheet.columns = fields.map(field => ({
        header: field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' '),
        key: field,
        width: 20
    }));

    // Add data
    worksheet.addRows(exportData);

    const tempFilePath = path.join(os.tmpdir(), `profile_export_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(tempFilePath);

    const fileUrl = await saveFileToCDN(
        tempFilePath,
        `profile_exports/${exportId}_${Date.now()}.xlsx`,
        "offline-reviewbit/profile_exports",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    const fileSize = fs.statSync(tempFilePath).size;
    fs.unlinkSync(tempFilePath);

    return { fileUrl, fileSize };
}

module.exports = profileExportJob; 