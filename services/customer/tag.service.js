const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;

"use strict";


module.exports = {
    name: "tag",
    mixins: [dbMixin("tag")],
    actions: {
        // Action to create a new tag with error handling
        createTag: {
            params: {
                name: { type: "string" },
                description: { type: "string", optional: true },
                type: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { name, description, type } = ctx.params;
                const { org_id, branch_id } = ctx.meta;

                try {
                    // Simulate role check
                    if (ctx.meta.scopes.includes("customer_write") || ctx.meta.scopes.includes("full_control")) {
                        // Simulate checking if the tag already exists
                        const existingTag = await this.adapter.model.findOne({
                            name,
                            org_id,
                            branch_id
                        });

                        if (existingTag) {
                            console.log("Tag already exists");
                            throw {
                                code: 400,
                                success: false,
                                message: "Tag already exists",
                                data: existingTag
                            };
                        }

                        const insertedDoc = await this.adapter.insert({
                            name,
                            description,
                            org_id,
                            branch_id,
                            type
                        });
                        return {
                            code: "200",
                            success: true,
                            message: "Tag created successfully",
                            data: insertedDoc
                        };
                    } else {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    throw new MoleculerError(error?.message ?? "Failed to create tag", error?.code ?? 500, error?.type ?? "TAG_CREATION_FAILED");
                }
            }
        },

        // Action to get all tags
        getTag: {
            rest: {
                method: "GET",
                path: "/tags"
            },
            params: {
                type: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { type } = ctx.params;
                const { org_id, branch_id } = ctx.meta;
                if (ctx.meta.scopes.includes("customer_read") || ctx.meta.scopes.includes("full_control")) {
                    // Simulate fetching tags
                    const tags = await this.adapter.find({ org_id, branch_id, type });
                    if (!tags || tags.length === 0) {
                        throw new MoleculerError("No tags found", 404, "NOT_FOUND");
                    }
                    return {
                        code: "200",
                        success: true,
                        message: "Tags fetched successfully",
                        data: tags
                    };
                }
                else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        // Action to delete a tag
        delete: {
            params: {
                id: { type: "number" }
            },
            async handler(ctx) {
                const { id } = ctx.params;
                // Simulate deleting the tag
                return { message: `Tag with id ${id} deleted successfully` };
            }
        }
    }
};