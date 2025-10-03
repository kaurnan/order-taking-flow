const { connectMongo } = require("../../models/init-db");
const { ObjectId } = require("mongodb");

const bulkCustomerUpdateJob = async (job) => {
    try {
        const { action, query, data } = job.data || {};

        console.log(`🔄 Processing bulk customer update job ${job.id} for action: ${action}`);

        // Update job progress
        await job.updateProgress(10);

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

        await job.updateProgress(30);

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
            remove_from_list: {
                $pull: {
                    lists: {
                        $in: data.map((e) => isValidObjectId(e) ? ObjectId.createFromHexString(e) : e),
                    },
                },
                $set: { updated_at: new Date() },
            },
            export: {},
        };

        await job.updateProgress(50);

        let updateResult = { modifiedCount: 0 };

        if (action === "delete") {
            await customersCollection.deleteMany(_query);
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

        await job.updateProgress(100);

        return {
            success: true,
            modifiedCount: modifiedCount,
            action: action,
            query: query
        };
    } catch (error) {
        console.error("Error in bulk customer update job:", error);
        throw error; // Re-throw the error so BullMQ can handle it properly
    }
};

module.exports = bulkCustomerUpdateJob;

