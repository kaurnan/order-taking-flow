const { MoleculerError } = require("moleculer").Errors;
const DbMixin = require("../../mixins/db.mixin");
const mongoose = require("mongoose");

"use strict";


module.exports = {
    name: "custom_folders",
    mixins: [DbMixin("customfolder")],
    /**
     * Service settings
     */
    settings: {
        // Add your service settings here
    },

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {
        GetCustomFolders: {
            auth: "required",
            params: {

            },
            async handler(ctx) {
                const { branch_id } = ctx.meta;
                try {
                    if (ctx.meta.scopes.includes("conversation_read") || ctx.meta.scopes.includes("full_control") || ctx.meta.scopes.includes("conversation_write")) {
                        const record = await this.adapter.model.find({ branch_id: new mongoose.Types.ObjectId(branch_id) });
                        return {
                            success: true,
                            message: "Custom folders fetched successfully",
                            data: record,
                        };
                    }
                    else {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }
                } catch (error) {
                    return {
                        code: "500",
                        success: false,
                        message: "An error occurred while fetching custom folders",
                        error: error.message,
                    };
                }
            }
        },

        CreateCustomFolder: {
            auth: "required",
            params: {
                title: "string",
                parent: "string",
                path: "string",
                meta: "object",
                channels: {
                    type: "array",
                    items: "string"
                }
            },
            async handler(ctx) {
                const { title, parent, path, meta, channels } = ctx.params;
                const { branch_id } = ctx.meta;

                try {
                    if (!ctx.meta.scopes.includes("conversation_write") && !ctx.meta.scopes.includes("full_control")) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    const existing = await this.adapter.findOne({ title, branch_id });
                    if (existing) {
                        throw new MoleculerError("Folder with this name already exists", 409, "FOLDER_EXISTS");
                    }

                    const created = await this.adapter.insert({
                        title,
                        branch_id,
                        parent,
                        path,
                        meta,
                        channels
                    });

                    return {
                        success: true,
                        message: "Folder created successfully",
                        data: created,
                    };

                } catch (error) {
                    return {
                        code: "500",
                        success: false,
                        message: "An error occurred while creating the folder",
                        error: error.message,
                    };
                }
            }
        },

        UpdateCustomFolder: {
            auth: "required",
            params: {
                id: "string",          // ID of the folder to update
                title: "string",       // New title for the folder
                parent: "string",      // New parent folder ID
                path: "string",        // New folder path
                meta: "object",         // New metadata object,
                channels: {
                    type: "array",
                    items: "string"
                }
            },
            async handler(ctx) {
                const { id, title, parent, path, meta, channels } = ctx.params;
                const { branch_id } = ctx.meta;

                try {
                    // Scope validation
                    if (!ctx.meta.scopes.includes("conversation_write") && !ctx.meta.scopes.includes("full_control")) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    // Find existing folder by ID and branch
                    const folder = await this.adapter.findOne({ _id: id, branch_id });
                    if (!folder) {
                        throw new MoleculerError("Folder not found or access denied.", 404, "FOLDER_NOT_FOUND");
                    }

                    // Check for duplicate title in the same branch (excluding current folder)
                    const duplicate = await this.adapter.findOne({ title, branch_id, _id: { $ne: id } });
                    if (duplicate) {
                        throw new MoleculerError("Another folder with this title already exists.", 409, "FOLDER_EXISTS");
                    }

                    // Perform the update
                    const updated = await this.adapter.updateById(id, {
                        $set: {
                            title,
                            parent,
                            path,
                            meta,
                            channels
                        }
                    });

                    return {
                        success: true,
                        message: "Folder updated successfully",
                        data: updated
                    };

                } catch (error) {
                    return {
                        code: "500",
                        success: false,
                        message: "An error occurred while updating the folder",
                        error: error.message
                    };
                }
            }
        },

        DeleteCustomFolder: {
            auth: "required",
            params: {
                id: "string", // Folder ID to delete
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const { branch_id } = ctx.meta;

                try {
                    // Check permissions
                    if (
                        !ctx.meta.scopes.includes("conversation_write") &&
                        !ctx.meta.scopes.includes("full_control")
                    ) {
                        throw new MoleculerError(
                            "You do not have permission to perform this action.",
                            403,
                            "FORBIDDEN"
                        );
                    }

                    // Check if folder exists and belongs to branch
                    const folder = await this.adapter.findOne({ _id: id, branch_id });
                    if (!folder) {
                        throw new MoleculerError(
                            "Folder not found or access denied.",
                            404,
                            "FOLDER_NOT_FOUND"
                        );
                    }

                    // Delete the folder
                    await this.adapter.removeById(id);

                    return {
                        success: true,
                        message: "Folder deleted successfully",
                    };
                } catch (error) {
                    return {
                        code: "500",
                        success: false,
                        message: "An error occurred while deleting the folder",
                        error: error.message,
                    };
                }
            },
        }

    },

    /**
     * Events
     */
    events: {
        // Define service events here
    },

    /**
     * Methods
     */
    methods: {
        // Define private methods here
    },

    /**
     * Service lifecycle events
     */
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