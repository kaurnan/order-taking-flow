const dbMixin = require("../../mixins/db.mixin");

module.exports = {
    name: "flowstore_tags",
    mixins: [dbMixin("flowstore/tags")],
    actions: {
        listTags: {
            async handler() {
                // Logic to list all tags
                return ["tag1", "tag2", "tag3"];
            }
        },
        addTag: {
            params: {
                name: "string"
            },
            async handler(ctx) {
                const { name } = ctx.params;
                // Logic to add a new tag
                return { message: `Tag '${name}' added successfully.` };
            }
        },
        removeTag: {
            params: {
                name: "string"
            },
            async handler(ctx) {
                const { name } = ctx.params;
                // Logic to remove a tag
                return { message: `Tag '${name}' removed successfully.` };
            }
        }
    },
    methods: {
        async seedDB() {
            await this.adapter.insertMany([
                { name: "Collect Reviews" },
                { name: "Order Confirmation" },
                { name: "Customer Support" },
                { name: "Feedback Collection" },
                { name: "Product Recommendations" },
                { name: "Event Notifications" },
                { name: "Promotional Campaigns" },
                { name: "User Engagement" },
                { name: "Survey Distribution" },
                { name: "Content Sharing" }
            ]);
        }
    }
};