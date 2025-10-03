const dotenv = require("dotenv");
dotenv.config();
const path = require("path");
const { connectMongo } = require("../../models/init-db");
const { ObjectId } = require("mongodb");
const fs = require("fs");

const mergeListJob = async (job) => {
    try {
        function logToFile(message) {
            const logDir = path.resolve(__dirname, "../logs");
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const logFilePath = path.join(logDir, `merge-list-${new Date().toISOString().split("T")[0]}.log`);
            const timestamp = new Date().toISOString();
            fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
        }

        const { sourceListIds, destinationListId, deleteSourceLists, org_id, branch_id, user_id } = job.data || {};

        console.log(`🔄 Processing merge list job ${job.id} for org: ${org_id}, branch: ${branch_id}`);
        logToFile("⚙️ Merge list started with params: " + JSON.stringify(job.data));

        // Update job progress
        await job.updateProgress(10);

        // Validate input parameters
        if (!sourceListIds || !Array.isArray(sourceListIds) || sourceListIds.length === 0) {
            throw new Error("Source list IDs are required and must be an array");
        }

        if (!destinationListId) {
            throw new Error("Destination list ID is required");
        }

        if (!org_id || !branch_id) {
            throw new Error("Organization ID and Branch ID are required");
        }

        // Check if source and destination are the same
        if (sourceListIds.includes(destinationListId)) {
            throw new Error("Source and destination lists cannot be the same");
        }

        await job.updateProgress(20);

        const db = await connectMongo();
        const listsCollection = db.collection("lists");
        const customersCollection = db.collection("customers");

        logToFile("⚙️ Connected to MongoDB");

        // Validate that all lists exist and belong to the same org/branch
        const allListIds = [...sourceListIds, destinationListId];
        const lists = await listsCollection.find({
            _id: { $in: allListIds.map(id => new ObjectId(id)) },
            org_id,
            branch_id
        }).toArray();

        if (lists.length !== allListIds.length) {
            throw new Error("One or more lists not found or access denied");
        }

        const destinationList = lists.find(list => list._id.toString() === destinationListId);
        const sourceLists = lists.filter(list => sourceListIds.includes(list._id.toString()));

        logToFile(`⚙️ Found ${lists.length} lists (${sourceLists.length} source, 1 destination)`);

        await job.updateProgress(30);

        // Get all customers from source lists
        const sourceCustomers = await customersCollection.find({
            lists: { $in: sourceListIds.map(id => new ObjectId(id)) },
            org_id: new ObjectId(org_id),
            branch_id: new ObjectId(branch_id)
        }).toArray();

        logToFile(`⚙️ Found ${sourceCustomers.length} customers in source lists`);

        if (sourceCustomers.length === 0) {
            logToFile("⚙️ No customers found in source lists to merge");
            await job.updateProgress(100);
            return {
                success: true,
                message: "No customers found in source lists to merge",
                data: {
                    mergedCount: 0,
                    destinationList: destinationList.title
                }
            };
        }

        await job.updateProgress(40);

        // Get existing customers in destination list to avoid duplicates
        const existingDestinationCustomers = await customersCollection.find({
            lists: { $in: [new ObjectId(destinationListId)] },
            org_id: new ObjectId(org_id),
            branch_id: new ObjectId(branch_id)
        }).toArray();

        logToFile(`⚙️ Found ${existingDestinationCustomers.length} existing customers in destination list`);

        // Create a set of existing customer IDs in destination for quick lookup
        const existingCustomerIds = new Set(existingDestinationCustomers.map(customer => customer._id.toString()));

        // Filter out customers that are already in the destination list
        const customersToAdd = sourceCustomers.filter(customer =>
            !existingCustomerIds.has(customer._id.toString())
        );

        logToFile(`⚙️ ${customersToAdd.length} customers will be added to destination list`);

        if (customersToAdd.length === 0) {
            logToFile("⚙️ All customers from source lists are already in the destination list");
            await job.updateProgress(100);
            return {
                success: true,
                message: "All customers from source lists are already in the destination list",
                data: {
                    mergedCount: 0,
                    destinationList: destinationList.title
                }
            };
        }

        await job.updateProgress(50);

        // Add destination list to customers that aren't already in it
        const customerIdsToUpdate = customersToAdd.map(customer => customer._id);

        const addResult = await customersCollection.updateMany(
            {
                _id: { $in: customerIdsToUpdate },
                org_id: new ObjectId(org_id),
                branch_id: new ObjectId(branch_id)
            },
            {
                $addToSet: { lists: new ObjectId(destinationListId) }
            }
        );

        logToFile(`⚙️ Added destination list to ${addResult.modifiedCount} customers`);

        await job.updateProgress(70);

        // Remove source lists from all customers (including those that were already in destination)
        let totalRemoved = 0;
        for (const sourceListId of sourceListIds) {
            const removeResult = await customersCollection.updateMany(
                {
                    lists: { $in: [new ObjectId(sourceListId)] },
                    org_id: new ObjectId(org_id),
                    branch_id: new ObjectId(branch_id)
                },
                {
                    $pull: { lists: new ObjectId(sourceListId) }
                }
            );
            totalRemoved += removeResult.modifiedCount;
        }

        logToFile(`⚙️ Removed source lists from ${totalRemoved} customers`);

        await job.updateProgress(80);

        // Delete source lists if requested
        if (deleteSourceLists) {
            const deleteResult = await listsCollection.deleteMany({
                _id: { $in: sourceListIds.map(id => new ObjectId(id)) },
                org_id,
                branch_id
            });
            logToFile(`⚙️ Deleted ${deleteResult.deletedCount} source lists`);
        }

        await job.updateProgress(90);

        // Get final count of customers in destination list
        const finalDestinationCount = await customersCollection.countDocuments({
            lists: { $in: [new ObjectId(destinationListId)] },
            org_id: new ObjectId(org_id),
            branch_id: new ObjectId(branch_id)
        });

        logToFile(`⚙️ Final destination list count: ${finalDestinationCount}`);

        const result = {
            success: true,
            message: `Successfully merged ${customersToAdd.length} customers into destination list`,
            data: {
                mergedCount: customersToAdd.length,
                destinationList: destinationList.title,
                destinationListId: destinationListId,
                finalDestinationCount: finalDestinationCount,
                sourceListsDeleted: deleteSourceLists,
                sourceListTitles: sourceLists.map(list => list.title),
                org_id,
                branch_id,
                user_id
            }
        };

        logToFile("✅ Merge list completed successfully: " + JSON.stringify(result));
        console.log(`✅ Merge list job ${job.id} completed successfully`);

        await job.updateProgress(100);
        return result;

    } catch (error) {
        const errorMessage = `❌ Error in mergeList job: ${error.message}`;
        console.error(errorMessage);

        // Log error to file
        try {
            const logDir = path.resolve(__dirname, "../logs");
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const logFilePath = path.join(logDir, `merge-list-${new Date().toISOString().split("T")[0]}.log`);
            const timestamp = new Date().toISOString();
            fs.appendFileSync(logFilePath, `[${timestamp}] ${errorMessage}\n`);
        } catch (logError) {
            console.error("Failed to log error to file:", logError);
        }

        throw error; // Re-throw the error so BullMQ can handle it properly
    }
};

module.exports = mergeListJob;
