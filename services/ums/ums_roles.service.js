"use strict";

const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;

module.exports = {
    name: "ums_roles",
    mixins: [dbMixin("ums/roles")],
    /**
     * Service settings
     */
    settings: {
        // Define service settings here
    },

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {
        /**
         * List all roles
         */
        listRoles: {
            auth: "required",
            rest: "GET /",
            async handler(ctx) {
                const { org_id } = ctx.meta;
                const { page = 1, pageSize = 10, search } = ctx.params;
                const query = {
                    org_id,
                };
                const skip = (page - 1) * pageSize;
                if (search) query.name = { $regex: search, $options: "i" };
                const docs = await this.adapter.model.find(query).populate("scopes").select("-org_id -__v").skip(skip).limit(pageSize);
                const total = await this.adapter.model.countDocuments(query);
                return { status: true, message: "Roles fetched successfully", data: docs, total, page: parseInt(page), pageSize: parseInt(pageSize), totalPages: Math.ceil(total / pageSize) };
            },
        },

        /**
         * Get a role by ID
         */
        getRole: {
            auth: "required",
            rest: "GET /:id",
            params: {
                id: "string",
            },
            async handler(ctx) {
                const { id } = ctx.params;
                // Fetch role by ID
                const role = await this.adapter.model.findById(id).select("-org_id -deletable -__v");
                return role || new MoleculerError("Role not found", 404, "NOT_FOUND");
            },
        },

        getUserScopes: {
            rest: "GET /user",
            auth: "required",
            params: {
                org_id: "string",
            },
            async handler(ctx) {
                const { org_id } = ctx.params;
                const { app_id, _id } = ctx.meta;
                const doc = await this.adapter.model.findOne({ app_id, org_id, user_id: _id }).populate("scopes");
                if (!doc) {
                    throw new Error("User not found");
                }
                return { message: "User scopes fetched successfully", data: doc.scopes?.map(scope => scope.access), status: true };
            },
        },

        /**
         * Create a new role
         */
        createRole: {
            auth: "required",
            rest: "POST /",
            params: {
                name: "string",
                scopes: { type: "array", items: "string", optional: true },
                deletable: { type: "boolean", optional: true, default: true },
            },
            async handler(ctx) {
                try {
                    const { name, scopes, deletable } = ctx.params;
                    const org_id = ctx.params.org_id || ctx.meta.org_id;
                    const { app_id } = ctx.meta;
                    if (ctx.meta?.scopes?.includes("full_control") === false) {
                        throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                    }
                    const role = await this.adapter.model.create({
                        name,
                        org_id,
                        scopes,
                        deletable: deletable ?? true, // Default to true if not provided
                        app_id
                    });
                    // Create and return new role
                    return { message: "Role created successfully", status: true, data: role };
                } catch (error) {
                    if (error?.code === 11000) {
                        return { message: "Role already exists!", status: false };
                    }
                    console.error(error);
                }
            },
        },

        /**
         * Update a role
         */
        updateRole: {
            rest: "PUT /:id",
            params: {
                id: "string",
                name: "string",
                scopes: { type: "array", items: "string", optional: true },
            },
            async handler(ctx) {
                try {
                    const { id, name, scopes } = ctx.params;
                    const { org_id, app_id } = ctx.meta;
                    if (!this.checkUserContainsFullControl(ctx)) {
                        throw new Error("Access denied");
                    }
                    const role = await this.adapter.model.findOneAndUpdate(
                        { _id: id, org_id, app_id },
                        { name, scopes },
                        { new: true }
                    );
                    if (!role) {
                        throw new Error("Role not found or update failed");
                    }
                    // Update and return role
                    return { message: "Role updated successfully", data: role, status: true };
                }
                catch (error) {
                    if (error?.code === 11000) {
                        return { message: "Role already exists!", status: false };
                    }
                    console.error(error);
                }
            },
        },

        /**
         * Delete a role
         */
        deleteRole: {
            rest: "DELETE /:id",
            params: {
                id: "string",
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const { org_id, app_id } = ctx.meta;
                if (!this.checkUserContainsFullControl(ctx)) {
                    throw new Error("Access denied");
                }
                const role = await this.adapter.model.findOne({ _id: id, org_id, app_id });
                if (!role) {
                    return { status: false, message: "Role not found or delete failed" };
                }
                if (role.name === "Admin") {
                    return { status: false, message: "'Admin' role cannot be deleted" };
                }
                await this.adapter.model.findOneAndDelete({ _id: id, org_id, app_id });
                return { status: true, message: "Role deleted successfully" };
            },
        },

        checkUserContainsFullControl: {
            async handler(ctx) {
                return ctx.meta?.scopes.includes("full_control");
            }
        }
    },

    /**
     * Service methods
     */
    methods: {
        checkUserContainsFullControl(ctx) {
            return ctx.meta?.scopes.includes("full_control");
        }
    },

    /**
     * Service lifecycle events
     */
    events: {
        // Define service events here
    },

    /**
     * Service created lifecycle event
     */
    created() {
        // Called when the service is created
    },

    /**
     * Service started lifecycle event
     */
    async started() {
        // Called when the service is started
    },

    /**
     * Service stopped lifecycle event
     */
    async stopped() {
        // Called when the service is stopped
    },

    hooks: {
    },

};