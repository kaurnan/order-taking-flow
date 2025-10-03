const dbMixin = require("../../mixins/db.mixin");
const FlowstoreList = require("../../models/flowstore/list.model");
const { ObjectId } = require("mongodb");
const { MoleculerError } = require("moleculer").Errors;

module.exports = {
    name: "flowstorecreator",
    mixins: [dbMixin("flowstore/creator")],
    actions: {
        MyAutomations: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/my-automations"
            },
            async handler(ctx) {
                console.log(ctx.meta);
                const { user } = ctx.meta;
                const uid = new ObjectId(user._id);
                console.log("Fetching automations for user:", user._id);
                if (!user._id) {
                    throw new MoleculerError("User ID is required", 400, "BAD_REQUEST");
                }
                const Creator = await this.adapter.findOne({ uid });
                if (!Creator) {
                    throw new MoleculerError("No automations found for this user", 404, "NOT_FOUND");
                }
                const automations = await FlowstoreList.find({
                    creator: Creator._id,
                });
                if (!automations || automations.length === 0) {
                    return {
                        success: false,
                        message: "No automations found for this user",
                        data: []
                    };
                }
                return {
                    success: true,
                    message: "Automations retrieved successfully",
                    data: automations
                };

            }
        },
        GetCreator: {
            cache: false,
            rest: {
                method: "GET",
                path: "/creator"
            },
            params: {
                handle: { type: "string" },
            },
            async handler(ctx) {
                const { handle } = ctx.params;
                const creator = await this.adapter.findOne({ handle });
                return {
                    status: "success",
                    data: creator,
                    message: "Creator fetched successfully"
                };
            }
        },
    },
    methods: {
        async seedDB() {
            await this.adapter.insertMany([
                {
                    "name": "FlowFlex.ai",
                    "user_name": "flowflex",
                    "email": "gokulrajxa@gmail.com",
                    "user_id": "user123",
                    "profile_pic": "https://storage.googleapis.com/flowflex_bucket/Flowflex%20Assets/logo%201.png",
                    "desc": "Experienced flow creator specializing in automation.",
                    "flows_imported": 10,
                    "overall_rating": 4.5,
                    "uid": "6833dcc14fe8d5646f0eb59a"
                }
            ]);
        }
    }
};