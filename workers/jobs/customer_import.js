const { ObjectId } = require("mongodb");
const { connectMongo } = require("../../models/init-db");
const { FormatPhoneNumber, getCountryRegionCode } = require("../../utils/common");
const workerpool = require("workerpool");

/**
 * Inserts a batch of documents into the CustomerModel collection.
 *
 * @param batch - An array of documents to be inserted.
 * @returns The number of documents successfully inserted.
 * @throws If an error occurs during the insertion process.
 */
async function customerImport(batch, targetList, branch_id, org_id) {
    // Declare validDocs outside try block for error handling
    let validDocs = [];

    try {
        const options = { ordered: false };
        const db = await connectMongo()
        const customersCollection = db.collection("customers")

        // Filter and process documents with valid phone numbers
        validDocs = [];

        for (const doc of batch) {
            // First attempt: format phone number without country
            let formattedPhone = FormatPhoneNumber(doc.phone);

            // Second attempt: if first fails, try with country field converted to region code
            if (!formattedPhone && doc.country) {
                const regionCode = getCountryRegionCode(doc.country);
                if (regionCode) {
                    formattedPhone = FormatPhoneNumber(doc.phone, regionCode);
                    console.log(`Converted country "${doc.country}" to region code "${regionCode}" for phone ${doc.phone}`);
                } else {
                    console.log(`Could not convert country "${doc.country}" to region code for phone ${doc.phone}`);
                }
            }

            // Only include documents with valid phone numbers
            if (formattedPhone) {
                validDocs.push({
                    reference: doc.reference || "",
                    email: doc.email || "",
                    name: doc.name || "",
                    country: doc.country || "",
                    lists: targetList ? [new ObjectId(targetList)] : (doc.lists ? doc.lists.map(id => new ObjectId(id)) : []),
                    state: doc.state || "",
                    note: doc.note || "",
                    verified_email: doc.verified_email !== undefined ? doc.verified_email : false,
                    tags: doc.tags ? doc.tags.map(id => new ObjectId(id)) : [],
                    phone: formattedPhone, // Use the formatted phone number
                    addresses: doc.addresses || [],
                    tax_exemptions: doc.tax_exemptions || [],
                    email_marketing_consent: doc.email_marketing_consent !== undefined ? doc.email_marketing_consent : true,
                    sms_marketing_consent: doc.sms_marketing_consent !== undefined ? doc.sms_marketing_consent : true,
                    whatsapp_marketing_consent: doc.whatsapp_marketing_consent !== undefined ? doc.whatsapp_marketing_consent : true,
                    org_id: new ObjectId(org_id),
                    branch_id: new ObjectId(branch_id),
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            } else {
                console.log(`Skipping contact with invalid phone number: ${doc.phone} (country: ${doc.country || 'not specified'})`);
            }
            console.log("validDocs", validDocs)
        }

        // If no valid documents, return 0
        if (validDocs.length === 0) {
            console.log("No valid contacts found in batch - all phone numbers were invalid");
            return 0;
        }

        const result = await customersCollection.insertMany(validDocs, options);
        // MongoDB insertMany returns an object with insertedIds; use its keys length for a reliable count
        const insertedCount = result && result.insertedIds ? Object.keys(result.insertedIds).length : 0;
        console.log(`Successfully imported ${insertedCount} contacts out of ${batch.length} total`);
        return insertedCount;
    } catch (error) {
        if (error.writeErrors) {
            const insertedCount = validDocs.length - error.writeErrors.length;
            return insertedCount;
        } else {
            throw error;
        }
    }
}

workerpool.worker({
    customerImport
});