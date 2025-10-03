const DbMixin = require("../../mixins/db.mixin");
const mongoose = require("mongoose");
const { MoleculerError } = require("moleculer").Errors;
const { ObjectId } = require("mongodb");
const customerModel = require("../../models/customer.model");
"use strict";


module.exports = {
    name: "branch",
    mixins: [DbMixin("branch")],
    settings: {
        // Add service settings here if needed
    },
    dependencies: [],
    events: {
        // Add event handlers here if needed
    },
    actions: {
        init: {
            rest: "POST /init",
            auth: "required",
            params: {
                org_id: { type: "string", optional: false },
                name: { type: "string", min: 3 },
                profile_img: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { org_id, name, profile_img } = ctx.params;
                console.log("Received parameters:", { org_id, name, profile_img });

                const branch = await this.adapter.insert({
                    org_id: new mongoose.Types.ObjectId(org_id),
                    name: name,
                    profile_img: profile_img
                });
                console.log("Branch insertion result:", branch);

                if (!branch) {
                    console.error("Branch creation failed during insertion.");
                    return {
                        status: false,
                        message: "Failed to create branch"
                    };
                }

                if (branch) {
                    console.log("Branch created successfully, updating organisation...", {
                        _id: org_id,
                        branches: [branch._id.toString()]
                    });
                    await this.broker.call("ums_organisation.updateOrg", {
                        _id: org_id,
                        branches: [branch._id.toString()]
                    });
                    console.log("Organisation updated with new branch ID:", branch._id);

                    // Create broadcast overview for the new branch
                    await this.broker.call("broadcast_overview.create", {
                        org_id: org_id,
                        branch_id: branch._id.toString()
                    });

                    return {
                        status: true,
                        message: "Branch created successfully",
                        data: branch
                    };
                } else {
                    console.error("Unexpected error: Failed to create branch.");
                    return {
                        status: false,
                        message: "Failed to create branch"
                    };
                }
            }
        },
        create: {
            rest: "POST /",
            auth: "required",
            params: {
                name: { type: "string", min: 3 },
                org_id: { type: "string", optional: false },
                profile_img: { type: "string", optional: true },
                currency: { type: "string", optional: true },
                location: {
                    type: "object",
                    optional: true,
                    props: {
                        formatted_address: { type: "string", convert: true, optional: true },
                        latitude: { type: "number", convert: true, optional: true },
                        longitude: { type: "number", convert: true, optional: true }
                    }
                },
                timezone: { type: "string", optional: true },
            },
            async handler(ctx) {
                try {
                    // Check for duplicate branch name within the same organisation
                    const existingBranch = await this.adapter.findOne({
                        name: ctx.params.name,
                        org_id: new ObjectId(ctx.params.org_id)
                    });

                    if (existingBranch) {
                        return {
                            status: false,
                            message: "Branch with this name already exists in this organisation",
                            data: null
                        };
                    }

                    const branch = await this.adapter.insert(ctx.params);
                    if (branch) {
                        // Update the organisation with the new branch ID
                        await this.broker.call("ums_organisation.updateOrg", {
                            _id: ctx.params.org_id,
                            branches: [branch._id.toString()]
                        });

                        // Create broadcast overview for the new branch
                        await this.broker.call("broadcast_overview.create", {
                            org_id: ctx.params.org_id,
                            branch_id: branch._id.toString()
                        });

                        return {
                            status: true,
                            message: "Branch created successfully",
                            data: branch
                        };
                    } else {
                        return {
                            status: false,
                            message: "Failed to create branch",
                            data: null
                        };
                    }
                } catch (error) {
                    console.error("Error creating branch:", error);
                    return {
                        status: false,
                        message: "Failed to create branch: " + (error.message || "Unknown error"),
                        data: null
                    };
                }
            }
        },

        update: {
            rest: "PUT /:id",
            auth: "required",
            params: {
                id: { type: "string", min: 24, max: 24 },
                name: { type: "string", min: 3, optional: true },
                profile_img: { type: "string", optional: true },
                currency: { type: "string", optional: true },
                location: {
                    type: "object",
                    optional: true,
                    props: {
                        formatted_address: { type: "string", convert: true, optional: true },
                        latitude: { type: "number", convert: true, optional: true },
                        longitude: { type: "number", convert: true, optional: true }
                    }
                },
                timezone: { type: "string", optional: true },
            },
            async handler(ctx) {
                try {
                    const { id } = ctx.params;
                    const { org_id } = ctx.meta;
                    const updateData = { ...ctx.params };
                    delete updateData.id; // Remove id from update data

                    // Validate that the branch exists and belongs to the user's organisation
                    const existingBranch = await this.adapter.findById(id);
                    if (!existingBranch) {
                        return {
                            status: false,
                            message: "Branch not found",
                            data: null
                        };
                    }

                    // Check if the branch belongs to the user's organisation
                    if (existingBranch.org_id.toString() !== org_id) {
                        return {
                            status: false,
                            message: "You don't have permission to update this branch",
                            data: null
                        };
                    }

                    // Check for duplicate branch name within the same organisation if name is being updated
                    if (updateData.name && updateData.name !== existingBranch.name) {
                        const duplicateBranch = await this.adapter.findOne({
                            name: updateData.name,
                            org_id: new ObjectId(org_id),
                            _id: { $ne: new ObjectId(id) }
                        });

                        if (duplicateBranch) {
                            return {
                                status: false,
                                message: "Branch with this name already exists in this organisation",
                                data: null
                            };
                        }
                    }

                    // Update the branch
                    const updatedBranch = await this.adapter.model.findByIdAndUpdate(
                        id,
                        { $set: updateData },
                        { new: true }
                    );

                    if (updatedBranch) {
                        return {
                            status: true,
                            message: "Branch updated successfully",
                            data: updatedBranch
                        };
                    } else {
                        return {
                            status: false,
                            message: "Failed to update branch",
                            data: null
                        };
                    }
                } catch (error) {
                    console.error("Error updating branch:", error);
                    return {
                        status: false,
                        message: "Failed to update branch: " + (error.message || "Unknown error"),
                        data: null
                    };
                }
            }
        },

        listBranchesByOrgId: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/branches"
            },
            params: {
                page: { type: "number", integer: true, min: 1, optional: true, convert: true, default: 1 },
                pageSize: { type: "number", integer: true, min: 1, max: 100, optional: true, convert: true, default: 10 },
                search: { type: "string", optional: true, trim: true }
            },
            async handler(ctx) {
                console.log("Fetching branches for organisation ID:", ctx.meta.org_id);
                const orgId = new ObjectId(ctx.meta.org_id);
                const page = ctx.params.page || 1;
                const pageSize = ctx.params.pageSize || 10;
                const skip = (page - 1) * pageSize;

                const query = {
                    org_id: orgId
                };

                // Add search functionality
                if (ctx.params.search) {
                    const searchRegex = new RegExp(ctx.params.search, "i");
                    query.$or = [
                        { name: searchRegex }
                    ];
                }

                const sort = { createdAt: -1 };

                const [branches, total] = await Promise.all([
                    this.adapter.model.find(query).sort(sort).skip(skip).limit(pageSize),
                    this.adapter.model.countDocuments(query)
                ]);

                console.log("Branches fetched:", branches);
                if (!branches || branches.length === 0) {
                    console.error("No branches found for organisation ID:", orgId);
                    return {
                        data: [],
                        success: false,
                        message: "No branches found",
                        pagination: {
                            page,
                            pageSize,
                            total,
                            totalPages: Math.ceil(total / pageSize)
                        }
                    };
                }
                return {
                    code: "200",
                    success: true,
                    message: "Branches fetched successfully",
                    data: branches,
                    pagination: {
                        page,
                        pageSize,
                        total,
                        totalPages: Math.ceil(total / pageSize)
                    }
                };
            }
        },

        delete: {
            auth: "required",
            rest: "DELETE /:id",
            params: {
                id: { type: "string", min: 24, max: 24 }
            },
            async handler(ctx) {
                try {
                    const { id } = ctx.params;
                    const { org_id } = ctx.meta;

                    // Validate that the branch exists and belongs to the user's organisation
                    const branch = await this.adapter.findById(id);
                    if (!branch) {
                        return {
                            status: false,
                            message: "Branch not found",
                            data: null
                        };
                    }

                    // Check if the branch belongs to the user's organisation
                    if (branch.org_id.toString() !== org_id) {
                        return {
                            status: false,
                            message: "You don't have permission to delete this branch",
                            data: null
                        };
                    }

                    // Check if there are any customers associated with this branch
                    const customerCount = await customerModel.countDocuments({
                        branch_id: new ObjectId(id)
                    });
                    console.log("Customer count:", customerCount);

                    if (customerCount > 0) {
                        return {
                            status: false,
                            message: `Cannot delete branch. There are ${customerCount} customers associated with this branch. Please reassign or delete customers first.`,
                            data: null
                        };
                    }

                    // Delete the branch
                    const deletedBranch = await this.adapter.removeById(id);

                    if (deletedBranch) {
                        // Clean up broadcast overview for this branch
                        try {
                            await this.broker.call("broadcast_overview.delete", {
                                branch_id: id,
                                org_id
                            });
                        } catch (error) {
                            console.warn("Failed to cleanup broadcast overview:", error.message);
                        }

                        return {
                            status: true,
                            message: "Branch deleted successfully",
                            data: deletedBranch
                        };
                    } else {
                        return {
                            status: false,
                            message: "Failed to delete branch",
                            data: null
                        };
                    }
                } catch (error) {
                    console.error("Error deleting branch:", error);
                    return {
                        status: false,
                        message: "Failed to delete branch: " + (error.message || "Unknown error"),
                        data: null
                    };
                }
            }
        }
    },
    methods: {
        // Add service methods here if needed
    },
    created() {
        // Lifecycle event handler
    },
    started() {
        // Lifecycle event handler
    },
    stopped() {
        // Lifecycle event handler
    }
};
