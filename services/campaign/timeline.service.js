const DbMixin = require("../../mixins/db.mixin");
const TimelineModel = require("../../models/timeline.model");

module.exports = {
    name: 'timeline',
    mixins: [DbMixin('timeline')], // 'timelines' is the collection name in MongoDB

    settings: {
        fields: ['_id', 'type', 'reference', 'details', 'status', 'timestamp'],
        entityValidator: {
            type: 'string',
            reference: 'string', // Will be validated as ObjectId in action
            details: { type: 'string', optional: true },
            status: { type: 'string', optional: true }
        }
    },

    model: TimelineModel,

    actions: {
        /**
         * Create a new timeline entry.
         *
         * @param {String} type - The type of the event (e.g., 'user_action', 'system_event').
         * @param {String} reference - The ID of the referenced entity (e.g., user ID, flow ID).
         * @param {String} [details] - Additional details about the event.
         * @param {String} [status] - The status of the event (e.g., 'success', 'failed', 'pending').
         * @returns {Object} The created timeline entry.
         */
        create: {
            params: {
                type: { type: 'string' },
                reference: { type: 'string' }, // Expecting a string that can be converted to ObjectId
                details: { type: 'string', optional: true },
                status: { type: 'string', optional: true },
                org_id: { type: 'string', optional: true },
                title: { type: 'string', optional: true },
                event_type: { type: 'string', optional: true, default: 'system' }
            },
            async handler(ctx) {
                const { type, reference, details, status, org_id, title, event_type } = ctx.params;
                try {
                    const newEntry = await this.adapter.insert({
                        type,
                        reference: new this.adapter.model.base.Types.ObjectId(reference),
                        details,
                        title,
                        event_type,
                        status,
                        timestamp: new Date(),
                        org_id: org_id || ctx.meta.org_id // Use provided org_id or context's org_id
                    });
                    return newEntry;
                } catch (error) {
                    console.error('Error creating timeline entry:', error);
                    this.logger.error('Error creating timeline entry:', error);
                    throw new Error('Failed to create timeline entry.');
                }
            }
        },

        /**
         * List timeline entries with pagination and search options.
         *
         * @param {String} [page=1] - The page number.
         * @param {String} [pageSize=10] - The number of items per page.
         * @param {String} [search] - Search term for 'type' or 'details' fields.
         * @param {Object} [filter] - Additional filter parameters (type, reference).
         * @returns {Object} List of timeline entries with pagination metadata.
         */
        listTimelines: {
            auth: "required",
            params: {
                page: { type: 'string', optional: true, default: '1' },
                pageSize: { type: 'string', optional: true, default: '10' },
                search: { type: 'string', optional: true },
                type: { type: 'string', optional: true },
                reference: { type: 'string', optional: true },
            },
            async handler(ctx) {
                const { page, pageSize, search, type, reference } = ctx.params;
                const { org_id } = ctx.meta;
                let query = {
                    org_id: org_id // Filter by organization ID
                };

                if (type) {
                    query.type = type;
                }
                if (reference) {
                    // Convert reference to ObjectId if needed
                    try {
                        query.reference = new this.adapter.model.base.Types.ObjectId(reference);
                    } catch (e) {
                        query.reference = reference;
                    }
                }
                const skip = (parseInt(page) - 1) * parseInt(pageSize);

                if (search) {
                    query.$or = [
                        { type: { $regex: search, $options: 'i' } },
                        { details: { $regex: search, $options: 'i' } }
                    ];
                }

                try {
                    const total = await this.adapter.model.countDocuments(query);
                    const entries = await this.adapter.model.find(query)
                        .skip(skip)
                        .limit(parseInt(pageSize))
                        .sort({ timestamp: -1 }); // Sort by latest events first

                    return {
                        success: true,
                        message: 'Timeline entries fetched successfully',
                        data: entries,
                        pagination: {
                            total,
                            page: parseInt(page),
                            pageSize: parseInt(pageSize),
                            totalPages: Math.ceil(total / parseInt(pageSize)),
                        },
                    };
                } catch (error) {
                    this.logger.error('Error listing timeline entries:', error);
                    throw new Error('Failed to list timeline entries.');
                }
            }
        }
    },

    methods: {
        /**
         * Populate the DB with default timeline entries if needed.
         */
        async seedDB() {
            // No default entries for timeline, as they are event-driven.
            // You can add initial data here if required for testing or specific scenarios.
        }
    },

    /**
     * Service created lifecycle event handler.
     */
    async created() {
        // Any setup logic when the service is created
    },

    /**
     * Service started lifecycle event handler.
     */
    async started() {
        // Start MongoDB change stream for timeline collection
        this.logger.info('Starting MongoDB change stream for timeline collection...');
        try {
            const changeStream = this.adapter.model.watch([], { fullDocument: 'updateLookup' });

            changeStream.on('change', async (change) => {
                if (change.operationType === 'insert') {
                    const timelineEntry = change.fullDocument;
                    this.logger.info('New timeline entry inserted:', timelineEntry);

                    try {
                        await this.broker.call("notification.send", {
                            templateKey: "timeline_event",
                            variables: {
                                eventTitle: timelineEntry.title || timelineEntry.type,
                                eventDetails: timelineEntry.details || `New event: ${timelineEntry.type}`,
                                userImage: "N/A", // Placeholder, needs userDetails.user_image
                                eventLink: "N/A" // Placeholder, needs to be derived from context if required
                            },
                            additionalData: {
                                branch_id: "N/A", // Placeholder, needs query.branch_id
                                organisation_id: timelineEntry.org_id,
                                user_id: "N/A" // Placeholder, needs userDetails._id
                            }
                        });
                        this.logger.info("Notification sent successfully for timeline entry:", timelineEntry._id);
                    } catch (notificationError) {
                        this.logger.error("Error sending notification to Supabase for timeline entry:", timelineEntry._id, notificationError);
                    }
                }
            });

            changeStream.on('error', (error) => {
                this.logger.error('MongoDB Change Stream Error:', error);
            });

            this.changeStream = changeStream; // Store change stream for cleanup
            this.logger.info('MongoDB change stream for timeline collection started successfully.');

        } catch (error) {
            this.logger.error('Failed to start MongoDB change stream for timeline collection:', error);
        }
    },

    /**
     * Service stopped lifecycle event handler.
     */
    async stopped() {
        // Close the change stream when the service is stopped
        if (this.changeStream) {
            try {
                this.changeStream.close();
                this.logger.info('MongoDB change stream for timeline collection closed.');
            } catch (closeError) {
                this.logger.error('Error closing MongoDB change stream for timeline collection:', closeError);
            }
        }
    }
};
