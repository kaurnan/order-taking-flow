const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const FlowstorePlatform = require("../../models/flowstore/platform.model");
const creatorModel = require("../../models/flowstore/creator.model");

"use strict";

module.exports = {
    name: "flowstorelist",
    mixins: [dbMixin("flowstore/list")],
    settings: {
        // Add service settings here
    },
    dependencies: [],
    actions: {
        list: {
            cache: false,
            rest: {
                method: "POST",
                path: "/list",
            },
            params: {
                page: { type: "number", optional: true, default: 1 },
                pageSize: { type: "number", optional: true, default: 10 },
                search: { type: "string", optional: true },
                filter: {
                    type: "object",
                    optional: true,
                    props: {
                        creator: { type: "string", optional: true },
                        category: {
                            type: "enum",
                            values: [
                                "reviews",
                                "booking-appointments",
                                "marketing-promotions",
                                "order-placement",
                                "loyalty-referrals",
                                "education-training",
                                "alerts-notifications"
                            ],
                            optional: true
                        },
                        platform: { type: "enum", values: ["shopify", "petpooja"], optional: true },
                        price: { type: "enum", values: ["free", "paid"], optional: true },
                    }
                },
            },
            async handler(ctx) {
                const { page = 1, pageSize = 10, search, filter } = ctx.params;

                console.log(ctx.params);

                const query = {};
                if (filter) {
                    if (filter.category) {
                        query.category = filter.category;
                    }
                    if (filter.platform) {
                        const platformId = await FlowstorePlatform.findOne({ name: filter.platform });
                        query.platform = platformId ? platformId._id : null;
                    }
                    if (filter.price) {
                        if (filter.price === "free") {
                            query.isPaid = false;
                        } else if (filter.price === "paid") {
                            query.isPaid = true;
                        }
                    }
                    if (filter.creator) {
                        const creatorId = await creatorModel.findOne({ handle: filter.creator });
                        query.creator = creatorId ? new ObjectId(creatorId._id) : null;
                    }

                }
                console.log("Query:", query);
                const skip = (parseInt(page) - 1) * parseInt(pageSize);
                if (search) query.name = { $regex: search, $options: "i" };
                const total = await this.adapter.model.countDocuments(query);
                const flows = await this.adapter.model.find(query).skip(skip).limit(parseInt(pageSize)).populate({
                    path: "creator",
                    select: "name profile_pic",
                    model: creatorModel
                });

                return {
                    code: "200",
                    success: true,
                    message: "Flows fetched successfully",
                    data: flows,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pageSize: parseInt(pageSize),
                        totalPages: Math.ceil(total / parseInt(pageSize)),
                    },
                };
            },
        },

        TrendingFlows: {
            rest: {
                method: "GET",
                path: "/trending-flows",
            },
            params: {},
            async handler(ctx) {
                const platforms = await ctx.call("flowstoreplatform.listPlatforms");
                if (platforms.length === 0) {
                    throw new MoleculerError("No platforms found", 404, "PLATFORMS_NOT_FOUND");
                }

                const platformFlows = await Promise.all(
                    platforms.map(async (platform) => {
                        const flows = await this.adapter.model.aggregate([
                            { $match: { platform: platform._id } },
                            { $sort: { created_at: -1 } },
                            { $limit: 6 },
                            {
                                $lookup: {
                                    from: "flowstorecreators",
                                    localField: "creator",
                                    foreignField: "_id",
                                    as: "creatorDetails",
                                },
                            },
                        ]);
                        return { platform, flows };
                    })
                );


                return {
                    code: "200",
                    success: true,
                    message: "Trending flows fetched successfully",
                    data: platformFlows,
                };
            },
        },

        FlowsByPlatform: {
            rest: {
                method: "GET",
                path: "/flows-by-platform",
            },
            params: {
                platformId: { type: "string" }
            },
            async handler(ctx) {
                const { platformId } = ctx.params;
                if (!platformId) {
                    throw new MoleculerError("Platform ID is required", 400, "PLATFORM_ID_REQUIRED");
                }
                const platformIdObjectId = new ObjectId(platformId);
                const flows = await this.adapter.model.aggregate([
                    { $match: { platform: platformIdObjectId } },
                    { $sort: { created_at: -1 } },
                    {
                        $lookup: {
                            from: "flowstorecreators",
                            localField: "creator",
                            foreignField: "_id",
                            as: "creatorDetails",
                        },
                    },
                ]);

                return {
                    code: "200",
                    success: true,
                    message: "Flows by platform fetched successfully",
                    data: flows,
                };
            },

        },

        GetFlowDetails: {
            rest: {
                method: "GET",
                path: "/flow-details",
            },
            params: {
                handle: { type: "string" }
            },
            async handler(ctx) {
                const { handle } = ctx.params;
                if (!handle) {
                    throw new MoleculerError("Flow handle is required", 400, "FLOW_HANDLE_REQUIRED");
                }
                const flowDetails = await this.adapter.model.findOne({ handle }).populate({
                    path: "creator",
                    model: "FlowstoreCreator", // Specify the model name for the 'org_id' field
                }).populate({
                    path: "platform",
                    model: "FlowstorePlatform", // Specify the model name for the 'platform' field
                });
                if (!flowDetails) {
                    throw new MoleculerError("Flow not found", 404, "FLOW_NOT_FOUND");
                }

                return {
                    code: "200",
                    success: true,
                    message: "Flow details fetched successfully",
                    data: flowDetails,
                };
            },
        },

        UpdateFlow: {
            auth: "required",
            rest: {
                method: "PUT",
                path: "/flow-details/:id",
            },
            params: {
                id: { type: "string" },
                data: {
                    type: "object", props: {
                        name: { type: "string", min: 3, max: 100, optional: true },
                        desc: { type: "string", min: 3, optional: true },
                        category: {
                            type: "enum",
                            values: [
                                "reviews",
                                "booking-appointments",
                                "marketing-promotions",
                                "order-placement",
                                "loyalty-referrals",
                                "education-training",
                                "alerts-notifications"
                            ],
                            optional: true,
                        },
                        platform: { type: "string", optional: true }, // Assuming platform is a string ID
                        thumbnail: { type: "string", optional: true }, // Assuming thumbnail is a string ID
                        additional_imgs: {
                            type: "array",
                            items: { type: "string" }, // Assuming additional_imgs are string IDs
                            optional: true,
                        },
                        thumbnail_desc: { type: "string", optional: true, min: 3 },
                        handle: { type: "string", min: 3, max: 50, optional: true },

                    }
                },
            },
            async handler(ctx) {
                const { id, data } = ctx.params;
                if (!id) {
                    throw new MoleculerError("Flow ID is required", 400, "FLOW_ID_REQUIRED");
                }

                const updatedFlow = await this.adapter.model.findByIdAndUpdate(id, data, { new: true });
                if (!updatedFlow) {
                    throw new MoleculerError("Flow not found", 404, "FLOW_NOT_FOUND");
                }

                return {
                    code: "200",
                    success: true,
                    message: "Flow updated successfully",
                    data: updatedFlow,
                };
            },
        },
    },
    events: {
        // Add event listeners here
    },
    methods: {
        // Add service methods here
    },
    created() {
        // Called when the service is created
    },
    started() {

        // Called when the service is started
    },
    stopped() {
        // Called when the service is stopped
    },
};
