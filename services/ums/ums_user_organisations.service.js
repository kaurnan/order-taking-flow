"use strict";

const dbMixin = require("../../mixins/db.mixin");
const { MoleculerError } = require("moleculer").Errors;
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const Pricing = require("../../models/pricing.model");
const { ObjectId } = require("mongodb");
const userModel = require("../../models/ums/user.model");

dotenv.config(); // Load environment variables from .env file


module.exports = {
    name: "ums_user_organisations",
    mixins: [dbMixin("ums/user_organisations")],
    settings: {
        // Define the database collection/table name
        fields: ["_id", "userId", "organisationId", "role", "createdAt", "updatedAt"],

        // Validation schema for the service
        entityValidator: {
            userId: { type: "string", min: 1 },
            organisationId: { type: "string", min: 1 },
            role: { type: "string", optional: true },
        },
    },

    actions: {
        // Example action to find all user organisations with populated references
        listOrganisations: {
            auth: "required",
            rest: "GET /",
            async handler(ctx) {
                const docs = await this.adapter.model
                    .find({ user_id: ctx.meta._id }) // Filter by user ID
                    .populate({
                        path: "org_id",
                        model: "Organisation", // Specify the model name for the 'org_id' field
                        populate: {
                            path: "plan",
                            model: Pricing // Specify the model name for the 'plan' field
                        }
                    }).populate("role"); // Populate the organisationId reference

                return { message: "Organisations fetched successfully", data: docs };
            },
        },

        listUsersByOrg: {
            auth: "required",
            rest: "GET /users_byorg",
            params: {
                page: { type: "string", optional: true, default: 1 },
                pageSize: { type: "string", optional: true, default: 10 },
                search: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { org_id } = ctx.meta;
                const { page, pageSize, search } = ctx.params;

                const query = {
                    org_id: new ObjectId(org_id),
                };

                const skip = (parseInt(page) - 1) * parseInt(pageSize);
                const total = await this.adapter.model.countDocuments(query);
                if (search) {
                    query.$or = [
                        { title: { $regex: search, $options: "i" } },
                        { email: { $regex: search, $options: "i" } }
                    ];
                }
                const docs = await this.adapter.model
                    .find(query) // Filter by organisation ID
                    .select("user_id role status") // Select user_id and role fields
                    .populate({
                        path: "user_id",
                        select: "-password -__v -status", // Exclude the password field
                    })
                    .populate("role") // Populate the role reference
                    .skip(skip)
                    .limit(pageSize);

                return {
                    message: "Users fetched successfully",
                    data: docs.map(doc => ({
                        ...doc.user_id.toObject(),
                        role: doc.role,
                        status: doc.status,
                    })),
                    pagination: {
                        total,
                        page: parseInt(page),
                        pageSize: parseInt(pageSize),
                        totalPages: Math.ceil(total / pageSize),
                    },
                };
            },
        },

        mapUserToOrganisation: {
            auth: "required",
            rest: "POST /map_user",
            params: {
                user_id: { type: "string", min: 1 },
                org_id: { type: "string", min: 1 },
                role: { type: "string", optional: true }, // Optional role parameter
            },
            async handler(ctx) {
                const { user_id, org_id, role } = ctx.params;

                // Logic to map user to organisation
                await this.adapter.insert({ user_id, org_id, role });

                return { message: "User mapped to organisation successfully" };
            }
        },

        inviteUser: {
            auth: "required",
            rest: "POST /invite",
            params: {
                emails: { type: "array", items: "email", min: 1 },
                role: { type: "string" }
            },
            async handler(ctx) {
                const { emails, role } = ctx.params;
                const org_id = ctx.meta.org_id;
                const branch_id = ctx.meta.branch_id;
                if (ctx.meta.scopes.includes("full_control")) {
                    if (!emails || !Array.isArray(emails) || emails.length === 0 || !org_id) {
                        throw new MoleculerError("Emails and Organisation ID are required", 400, "VALIDATION_ERROR");
                    }
                    if (!ctx.meta.scopes.includes("full_control")) {
                        throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                    }

                    // Trigger background processing
                    this.processInvites(ctx, emails, role, org_id, branch_id)
                        .catch(err => this.logger.error("Invite processing failed:", err));

                    return {
                        success: true,
                        message: "Invitations are being processed in the background.",
                    };

                }
                else {
                    throw new MoleculerError("You do not have permission to perform this action.", 403, "FORBIDDEN");
                }
            }
        },

        acceptInvite: {
            rest: "GET /accept-invite",
            params: {
                token: { type: "string", min: 1 },
            },
            async handler(ctx) {
                const { token } = ctx.params;
                if (!token) {
                    throw new MoleculerError("Token is required", 400, "TOKEN_REQUIRED");
                }
                let decoded;
                try {
                    decoded = jwt.verify(token, process.env.JWT_SECRET);
                    console.log("Decoded token:", decoded);
                    const { org_id, role, email, user_id } = decoded;
                    if (!org_id || !role || !email || !user_id) {
                        throw new MoleculerError("Invalid token data", 400, "INVALID_TOKEN_DATA");
                    }

                    // Check if the user exists in the database
                    const userExists = await userModel.findOne({ _id: user_id });
                    if (!userExists) {
                        throw new MoleculerError("User does not exist", 404, "USER_NOT_FOUND");
                    }

                    await this.adapter.model.updateOne(
                        { user_id: user_id, org_id: org_id },
                        { $set: { status: "Active" } }
                    );

                    const redirectUrl = `${process.env.FE_HOST}/auth/login?reset=${userExists.email}`;

                    // Tell API Gateway to emit HTML:
                    ctx.meta.$responseType = "text/html";

                    // No body needed
                    return `<!DOCTYPE html>
                            <html lang="en">
                                <head>
                                    <meta charset="utf-8">
                                    <meta http-equiv="refresh" content="10;url=${redirectUrl}">
                                    <title>Invitation Accepted</title>
                                    <style>
                                        body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                                        .container { text-align: center; }
                                        a { color: #007bff; text-decoration: none; }
                                    </style>
                                </head>
                                <body>
                                    <div class="container">
                                        <h1>🎉 Invitation Accepted!</h1>
                                        <p>You’ll be taken to the login page in <strong>10 seconds</strong>.</p>
                                        <p>If nothing happens, <a href="${redirectUrl}">click here to log in now</a>.</p>
                                    </div>
                                </body>
                            </html>`;
                } catch (err) {
                    console.error("Error verifying token:", err);
                    throw new MoleculerError("Invalid or expired token", 401, "INVALID_TOKEN");
                }

            }
        },

        // Example action to create a new user organisation
        create: {
            rest: "POST /",
            params: {
                user_id: { type: "string", min: 1 },
                org_id: { type: "string", min: 1 }
            },
            async handler(ctx) {
                const { user_id, org_id } = ctx.params;

                if (!user_id || !org_id) {
                    throw new Error("User ID and Organisation ID are required");
                }
                const requiredScopes = [
                    "full_control",
                    "automation_write",
                    "waba_write",
                    "campaign_write",
                    "conversation_write",
                    "broadcast_write",
                    "audience_write"
                ];

                const scopes = await Promise.all(
                    requiredScopes.map(scope =>
                        ctx.call("ums_scopes.getScope", { access: scope })
                    )
                );

                const full_controlScope = scopes.find(scope => scope.access === "full_control");
                if (!full_controlScope) {
                    throw new Error("Full control scope not found");
                }
                if (!full_controlScope) {
                    throw new Error("Full control scope not found");
                }
                // Default roles in Flowflex
                const defaultRoles = [
                    { name: "Automation Creator", desc: "Role for creating automations", scopes: scopes.filter(scope => ["automation_write", "waba_write"].includes(scope.access)).map(scope => scope._id) },
                    { name: "Campaign Creator", desc: "Role for creating campaigns", scopes: scopes.filter(scope => ["campaign_write", "automation_write", "waba_write", "broadcast_write", "conversation_write", "audience_write"].includes(scope.access)).map(scope => scope._id) },
                    { name: "Support Agent", desc: "Role for handling conversations", scopes: scopes.filter(scope => ["conversation_write"].includes(scope.access)).map(scope => scope._id) },
                ];

                // Create default roles for the organisation
                for (const role of defaultRoles) {
                    await ctx.call("ums_roles.createRole", {
                        name: role.name,
                        desc: role.desc,
                        org_id,
                        scopes: role.scopes.map(scope => scope.toString()), // Convert ObjectId to string
                        deletable: false
                    }, {
                        meta: {
                            scopes: ["full_control"], // Ensure the user has full control to create roles
                            org_id: org_id
                        }
                    });
                }
                const role = await ctx.call("ums_roles.createRole", {
                    name: "Admin",
                    desc: "Administrator role with full access to all features",
                    org_id,
                    scopes: [full_controlScope._id.toString()],
                    deletable: false
                }, {
                    meta: {
                        scopes: ["full_control"], // Ensure the user has full control to create roles
                        org_id: org_id
                    }
                });
                const entity = {
                    user_id: user_id,
                    org_id: org_id,
                    role: role.data?._id,
                };
                const doc = await this.adapter.insert(entity);
                return doc.toObject();
            },
        },



        get: {
            auth: "required",
            rest: "GET /:id",
            params: {
                id: { type: "string", min: 1 },
            },
            async handler(ctx) {
                const id = ctx.params.id;
                const user_id = ctx.meta._id;
                const userOrganisation = await this.adapter.model.findOne({
                    org_id: id,
                    user_id
                }).populate("org_id"); // Populate the organisationId reference
                if (!userOrganisation) {
                    throw new Error("User organisation not found");
                }
                return { message: "Organisation fetched successfully", data: userOrganisation };
            }
        },

        listUsersByOrgID: {
            auth: "required",
            rest: "GET /users",
            params: {
                org_id: { type: "string", min: 1 },
            },
            async handler(ctx) {
                try {
                    const { org_id } = ctx.params;
                    const docs = await this.adapter.model
                        .find({ org_id }) // Filter by organisation ID
                        .populate("user_id"); // Populate the userId reference

                    return { message: "Users fetched successfully", data: docs, status: true };
                } catch (error) {
                    console.error("Error in listUsersByOrgID:", error);
                    return { message: "Error fetching users", status: false };
                }

            },
        },

        deleteTeamMember: {
            auth: "required",
            rest: {
                method: "DELETE",
                path: "/:org_id/users/:user_id"
            },
            params: {
                user_id: { type: "string", min: 1 }
            },
            async handler(ctx) {
                const { user_id } = ctx.params;
                const org_id = ctx.meta.org_id;
                if (ctx.meta.scopes.includes("full_control")) {
                    // Check if the user is part of the organisation
                    const isUserInOrg = await this.checkIsUserInOrg(user_id);
                    if (!isUserInOrg) {
                        return { message: "User is not part of the organisation", status: false };
                    }

                    // Remove the user from the organisation
                    await this.adapter.model.deleteOne({ org_id, user_id });

                    return { message: "User removed from organisation successfully", status: true };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        },

        changeTeamMemberStatus: {

            auth: "required",
            params: {
                org_id: { type: "string", min: 1 },
                user_id: { type: "string", min: 1 },
                status: { type: "string", enum: ["Active", "Invited", "Pending", "Rejected", "Archived"] }
            },
            async handler(ctx) {
                const { org_id, user_id, status } = ctx.params;
                if (ctx.meta.scopes.includes("full_control")) {
                    // Check if the user is part of the organisation
                    const isUserInOrg = await this.checkIsUserInOrg(user_id);
                    if (!isUserInOrg) {
                        return { message: "User is not part of the organisation", status: false };
                    }

                    // Archive the user by setting a flag or removing them from the active list
                    await this.adapter.model.updateOne({ org_id, user_id }, { $set: { status: status } });

                    return { message: "User status updated successfully", status: true };
                } else {
                    throw new MoleculerError("Permission denied", 403, "FORBIDDEN");
                }
            }
        }
    },

    hooks: {
        before: {
            // Add hooks if needed
        },
    },

    events: {
        // Add event listeners if needed
    },

    methods: {
        checkIsUserInOrg: async function (id) {
            // Check if a user is part of an organisation
            const userOrg = await this.adapter.model.findOne({ user_id: id });
            return !!userOrg; // Returns true if the user is in the organisation
        },

        processInvites: async function (ctx, emails, role, org_id, branch_id) {
            const results = [];
            const newlyInvitedEmails = [];

            for (const email of emails) {
                try {
                    const existingUser = await userModel.findOne({ email });

                    let userId;
                    if (!existingUser) {
                        const newUser = await userModel.create({
                            email,
                            full_name: email.split("@")[0]
                        });
                        userId = newUser._id;
                    } else {
                        userId = existingUser._id;

                        const orgUser = await this.adapter.model.findOne({
                            user_id: userId,
                            org_id,
                            status: { $in: ["Active", "Invited"] }
                        });

                        if (orgUser) {
                            results.push({
                                email,
                                success: false,
                                message: `User is already ${orgUser.status.toLowerCase()} in the organisation`
                            });
                            continue;
                        }
                    }

                    const invited = await this.InviteUser(ctx, email, org_id, role, userId);
                    if (!invited) {
                        results.push({ email, success: false, message: "Failed to send invitation email" });
                        continue;
                    }

                    await this.adapter.insert({
                        user_id: userId,
                        org_id,
                        role,
                        status: "Invited",
                        name: email.split("@")[0],
                        email: email
                    });

                    results.push({ email, success: true, message: "User invited successfully" });
                    newlyInvitedEmails.push(email);

                } catch (err) {
                    this.logger.error(`Failed to invite ${email}:`, err);
                    results.push({ email, success: false, message: err.message || "Unknown error" });
                }
            }

            // Update getstarted model to set user_invited to true
            try {
                await ctx.call("getstarted.updateUserInvited", { org_id });
            } catch (getstartedError) {
                this.logger.error("Failed to update getstarted user_invited:", getstartedError);
                // Don't fail the main operation if getstarted update fails
            }

            // Send notification based on whether there are new invitations or not
            try {
                let roleName = role;
                if (role && typeof role === 'string') {
                    try {
                        const roleData = await ctx.call("ums_roles.getRole", { id: role });
                        roleName = roleData.name;
                    } catch (roleError) {
                        this.logger.error("Failed to fetch role name:", roleError);
                        roleName = "Unknown Role"; // Fallback if role fetch fails
                    }
                }
                if (newlyInvitedEmails.length > 0) {
                    // Send notification for new invitations
                    await ctx.call("notification.send", {
                        templateKey: "user_invitations_sent",
                        variables: {
                            invited_emails: newlyInvitedEmails,
                            role: roleName,
                            count: newlyInvitedEmails.length
                        },
                        additionalData: {
                            user_id: ctx.meta._id,
                            organisation_id: org_id,
                            branch_id: branch_id
                        }
                    });
                } else {
                    // Send notification that invitations were already sent
                    await ctx.call("notification.send", {
                        templateKey: "user_invitations_already_sent",
                        variables: {
                            invited_emails: emails,
                            role: roleName,
                            count: emails.length
                        },
                        additionalData: {
                            user_id: ctx.meta._id,
                            organisation_id: org_id,
                            branch_id: branch_id
                        }
                    });
                }
            } catch (notificationError) {
                this.logger.error("Failed to send notification:", notificationError);
                // Don't fail the main operation if notification fails
            }

            console.log("Invitation results:", results);
            return {
                success: true,
                results,
                message: "Processed all invitations."
            };
        },

        InviteUser: async function (ctx, email, org_id, role, userId) {
            const InviteJWt = jwt.sign(
                { org_id, role, email, user_id: userId },
                process.env.JWT_SECRET,
                { expiresIn: "1d" }
            );

            const invitationLink = `${process.env.HOST}/api/accept-invite?token=${InviteJWt}`;
            try {
                await ctx.call("email.send", {
                    to: email,
                    subject: "You're Invited to Join the Organisation",
                    text: `Hi,\n\nYou have been invited to join the organisation. Please click the link below to accept the invitation:\n\n${invitationLink}\n\nThis link will expire in 1 day.`,
                    html: `<p>Hi,</p>
                           <p>You have been invited to join the organisation.</p>
                           <p>Please click the link below to accept the invitation:</p>
                           <p><a href="${invitationLink}" target="_blank">${invitationLink}</a></p>
                           <p>This link will expire in 1 day.</p>`
                });

                return true;
            } catch (err) {
                console.error("Failed to send invitation email", err);
                return false;
            }
        },
        // Add custom service methods if needed
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