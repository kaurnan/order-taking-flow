"use strict";

const jwt = require("jsonwebtoken");
const ApiGateway = require("moleculer-web");
const { verifyGoogleLoginToken, hashPassword, verifyFacebookToken } = require("../../utils/helpers");
const { comparePassword } = require("../../utils/common");
const { UnAuthorizedError } = ApiGateway.Errors;
const Redis = require("ioredis");
const dbMixin = require("../../mixins/db.mixin");
const user_inviteModel = require("../../models/ums/user_invite.model");
const user_organisationsModel = require("../../models/ums/user_organisations.model");

require("dotenv").config();

const redis = new Redis(process.env.REDIS_URI);

module.exports = {
    name: "ums_user",
    mixins: [dbMixin("ums/user")],

    settings: {
        fields: ["_id", "app_id", "email", "created_at", "updated_at", "full_name", "availability", "organisation_created", "email_verified", "last_login"]
    },

    actions: {
        /**
         * GET: /user
         * List all users for the current organization.
         * @returns {Array} - List of users.
         * @throws {Error} - If the user is not authenticated.
         */
        listUsers: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/",
            },
            async handler(ctx) {
                try {
                    const { org_id } = ctx.meta;

                    // Get all users in the current organization
                    const userOrgs = await user_organisationsModel.find({ org_id })
                        .populate('user_id', '-password -__v')
                        .populate('role')
                        .select('-__v');

                    // Return just the user details as before
                    const users = userOrgs.map(userOrg => userOrg.user_id);

                    return {
                        message: "Users fetched successfully",
                        status: true,
                        data: users,
                        total: users.length
                    };
                } catch (error) {
                    this.logger.error("List users error:", error);
                    throw new Error("Failed to fetch users");
                }
            }
        },

        /**
         * POST: /user
         * Create a new user with full_name, phone_number, and email.
         */
        create: {
            rest: {
                method: "POST",
                path: "/user"
            },
            params: {
                full_name: "string",
                phone_number: "string",
                email: "string"
            },
            async handler(ctx) {
                try {
                    // Check if the user already exists for the given app
                    const existingUser = await this.adapter.findOne({ email: ctx.params.email });
                    if (existingUser) {
                        // Exclude sensitive fields before returning
                        const { password, __v, ...filteredUser } = existingUser.toObject();
                        return { message: "User already exists", data: filteredUser };
                    }

                    // Create a new user if not found
                    const user = await this.adapter.insert({
                        ...ctx.params,
                        created_at: new Date(),
                        updated_at: new Date()
                    });

                    // Exclude sensitive fields before returning
                    const { password, __v, ...filteredUser } = user.toObject();
                    return { message: "User created successfully", data: filteredUser };
                } catch (error) {
                    throw new Error("Some thing went wrong!");
                }
            }
        },

        getUserByEmail: {
            rest: {
                method: "GET",
                path: "/user/email"
            },
            params: {
                email: "string"
            },
            async handler(ctx) {
                const user = await this.adapter.model.findOne({ email: ctx.params.email }).select("-password -__v");
                if (!user) {
                    return { message: "User not found", data: null };
                }
                return { message: "User fetched successfully", data: user.toObject() };
            }
        },

        /**
         * PATCH: /user/:id
         * Update a user.
         */
        update: {
            auth: "required",
            rest: {
                method: "PATCH",
                path: "/user/:id"
            },
            params: {
                id: "string",
                email: { type: "string", optional: true },
                full_name: { type: "string", optional: true },
                availability: { type: "boolean", optional: true },
                phone_number: { type: "string", optional: true },
            },
            async handler(ctx) {
                const updatedUser = await this.adapter.model.findByIdAndUpdate(
                    ctx.params.id,
                    { $set: ctx.params },
                    { new: true }
                );
                if (!updatedUser) {
                    return { message: "User not found", data: null };
                }
                if (ctx.params.full_name || ctx.params.email) {
                    await user_organisationsModel.findOneAndUpdate({ user_id: ctx.params.id }, {
                        $set: {
                            name: ctx.params.full_name,
                            email: ctx.params.email
                        }
                    });
                }
                const { password, __v, ...filteredUser } = updatedUser.toObject();
                return { message: "User updated successfully", data: filteredUser };
            }
        },

        /**
         * GET: /user/:id
         * Fetch a user by ID.
         */
        getUser: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/user"
            },
            params: {
            },
            async handler(ctx) {
                const user = await this.adapter.findById(ctx.meta._id);
                if (!user) throw new Error("User not found");
                return user;
            }
        },

        setPassword: {
            rest: {
                method: "POST",
                path: "/user/set-password"
            },
            params: {
                email: "string",
                password: "string",
                type: "string",
                token: "string"
            },
            async handler(ctx) {
                const { email, password, token, type } = ctx.params;


                // Find the user by email and app_id
                const user = await this.adapter.findOne({ email });
                if (!user) {
                    return { success: false, message: "User not found." };
                }

                // Verify the password
                const verifyPassword = await ctx.call("ums_password_reset.verifyToken", { email, token });

                //Hash the password
                const hashedPassword = await hashPassword(password);

                if (verifyPassword.success) {
                    await Promise.all([
                        this.adapter.updateById(user._id, { $set: { password: hashedPassword, has_password: true } }),
                        ctx.call("ums_password_reset.markAsUsed", { email, token })
                    ]);

                    if (type == "account_creation") {
                        const userInvites = await user_inviteModel.find({ email, status: "accepted" });
                        if (userInvites && userInvites.length > 0) {
                            await Promise.all(
                                userInvites.map(userInvite =>
                                    ctx.call("ums_user_organisations.mapUserToOrganisation", {
                                        user_id: user._id.toString(),
                                        org_id: userInvite.org_id?.toString(),
                                        role: userInvite.role?.toString()
                                    })
                                )
                            );
                        }
                    }

                    // Send email notification
                    ctx.call("email.send", {
                        to: email,
                        subject: `${type == "account_creation" ? "Your FlowFlex.ai User Is Ready" : "Your FlowFlex.ai Password Has Been Reset"}`,
                        text: type == "account_creation"
                            ? `Hi ${user.full_name},\n\nYour FlowFlex.ai user has been successfully created.\n\nWe’re excited to have you with us!\n\nBest,\nThe FlowFlex.ai Team`
                            : `Hi ${user.full_name},\n\nYour FlowFlex.ai password has been successfully reset. You can now log in using your new credentials.\n\nIf you did not request this change, please contact our support team immediately.\n\nHappy engaging,\nThe FlowFlex.ai Team`,
                        html: type == "account_creation"
                            ? `<p>Hi ${user.full_name},</p><p>Your FlowFlex.ai user has been successfully created.</p><p>We’re excited to have you with us!</p><p>Best,<br>The FlowFlex.ai Team</p>`
                            : `<p>Hi ${user.full_name},</p><p>Your FlowFlex.ai password has been successfully reset. You can now log in using your new credentials.</p><p>If you did not request this change, please contact our support team immediately.</p><p>Happy engaging,<br>The FlowFlex.ai Team</p>`
                    }).then(res => {
                        console.log("Email sent", res);
                    }).catch(err => {
                        console.error("Failed to send email", err);
                    });

                    // Send WhatsApp notification
                    if (type == "account_creation") {
                        ctx.call("whatsapp.sendMessage", {
                            to: user.phone_number,
                            body: {
                                name: "user_creation",
                                "language": {
                                    "code": "en"
                                },
                                components: [
                                    {
                                        type: "body",
                                        parameters: [
                                            {
                                                type: "text",
                                                text: user.full_name
                                            }
                                        ]
                                    }
                                ]
                            },
                            type: "template"
                        }).then(res => {
                            console.log("WhatsApp message sent", res);
                        }).catch(err => {
                            console.error("Failed to send WhatsApp message", err);
                        });
                    }
                    else {
                        ctx.call("whatsapp.sendMessage", {
                            to: user.phone_number,
                            body: {
                                name: "password_reset",
                                "language": {
                                    "code": "en"
                                },
                                components: [
                                    {
                                        type: "body",
                                        parameters: [
                                            {
                                                type: "text",
                                                text: user.full_name
                                            }
                                        ]
                                    }
                                ]
                            },
                            type: "template"
                        }).then(res => {
                            console.log("WhatsApp message sent", res);
                        }).catch(err => {
                            console.error("Failed to send WhatsApp message", err);
                        });
                    }

                    let response = { success: true, message: "Password set successfully." };
                    if (type === "account_creation") {
                        const token = jwt.sign(
                            { _id: user._id, ttl: 1 },
                            process.env.JWT_SECRET || "default-secret",
                            { expiresIn: "1d" }
                        );
                        response.token = token;
                    }
                    return response;
                }
                return { success: false, message: "Invalid token." };
            }
        },

        /**
         * POST: /user/forgot-password
         * Send a password reset OTP to the user.
         */
        forgotPassword: {
            reset: {
                method: "POST",
                path: "/user/forgot-password"
            },
            params: {
                email: "string",
                resend: "boolean",
                type: "string"
            },
            async handler(ctx) {
                const { email, type, resend } = ctx.params;
                const User = await this.adapter.findOne({ email });
                if (!User) {
                    return { success: false, message: "User not found." };
                }
                const response = await ctx.call("verify.storeCode", { email, resend, type, phone_number: User.phone_number });
                return response;
            }
        },

        socialLogin: {
            rest: {
                method: "POST",
                path: "/user/socialLogin"
            },
            params: {
                token: "any",
                type: "string",
                user_id: { type: "string", optional: true }
            },
            async handler(ctx) {

                const { user_id, token, type } = ctx.params;
                let userinfo = {};
                if (type == "google") {
                    userinfo = await verifyGoogleLoginToken(token);
                }
                else if (type == "facebook") {
                    userinfo = await verifyFacebookToken(token, user_id);
                }
                let user = await this.adapter.findOne({ email: userinfo?.email });
                if (!user) {
                    // Create a new user if not found
                    user = await this.adapter.insert({
                        full_name: userinfo?.name,
                        email: userinfo?.email,
                        email_verified: userinfo?.email_verified,
                        profile_pic: userinfo?.picture ?? null,
                        password: null,
                        created_at: new Date(),
                        updated_at: new Date(),
                        has_password: true,
                    });
                }
                // Generate a JWT token
                const _token = jwt.sign(
                    { _id: user._id, ttl: 1 },
                    process.env.JWT_SECRET || "default-secret",
                    { expiresIn: "1d" }
                );

                // Exclude sensitive fields before returning
                const { password, __v, ...filteredUser } = user.toObject();

                return { success: true, token: _token, user: filteredUser };
            }
        },

        socialSignup: {
            rest: {
                method: "POST",
                path: "/user/socialSignup"
            },
            params: {
                token: "string",
                type: "string",
                user_id: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { user_id, token, type } = ctx.params;
                let userinfo = {};
                if (type == "google") {
                    userinfo = await verifyGoogleLoginToken(token);
                }
                else if (type == "facebook") {
                    userinfo = await verifyFacebookToken(token, user_id);
                }
                const existingUser = await this.adapter.findOne({ email: userinfo.email });
                if (existingUser) {
                    // Exclude sensitive fields before returning
                    const { password, __v, ...filteredUser } = existingUser.toObject();
                    return { message: "User already exists", data: filteredUser };
                }

                // Create a new user if not found
                const user = await this.adapter.insert({
                    ...ctx.params,
                    created_at: new Date(),
                    updated_at: new Date(),
                    has_password: true,
                });

                // Exclude sensitive fields before returning
                const { password, __v, ...filteredUser } = user.toObject();
                return { message: "User created successfully", data: filteredUser };
            }
        },

        /**
         * Generate a new access token using the refresh token.
         */
        generateAccessToken: {
            rest: {
                method: "GET",
                path: "/user/generate-access-token"
            },
            params: {
                refreshToken: "string"
            },
            async handler(ctx) {
                const tokenResponse = await ctx.call("ums_user.refreshToken", { rt: ctx.params.refreshToken });
                if (!tokenResponse.success) {
                    return { success: false, message: "Failed to generate access token." };
                }
                return { success: true, access_token: tokenResponse.data };
            }
        },

        /**
         * Login a user using email and password.
         */
        authenticate: {
            rest: {
                method: "POST",
                path: "/user/authenticate"
            },
            // cache: true,
            params: {
                email: "string",
                password: "string",
                remember: { type: "boolean", optional: true }
            },
            async handler(ctx) {
                const { email, remember } = ctx.params;
                const pass = ctx.params.password;

                try {
                    // Find the user by email and app_id
                    const user = await this.adapter.findOne({ email });
                    console.log(user);
                    if (!user) {
                        return { success: false, message: "Invalid credentials." };
                    }

                    if (!user.email_verified) {
                        return { success: false, message: "Email not verified." };
                    }

                    if (!user.password) {
                        return { success: false, message: "User not registered with a password." };
                    }

                    // Verify the password (assuming passwords are hashed)
                    const isPasswordValid = await comparePassword(user.password, pass);
                    if (!isPasswordValid) {
                        return { success: false, message: "Invalid credentials." };
                    }

                    // Generate a JWT token
                    const token = jwt.sign(
                        { _id: user._id, ttl: remember ? 30 : 1 },
                        process.env.JWT_SECRET || "default-secret",
                        { expiresIn: "1d" }
                    );

                    // Exclude sensitive fields before returning
                    const { password, __v, ...filteredUser } = user.toObject();
                    const lastLogin = new Date().toISOString();
                    await this.adapter.model.findByIdAndUpdate(user._id, { $set: { last_login: lastLogin } });
                    return { success: true, token, user: filteredUser };
                } catch (error) {
                    this.logger.error("Authentication error:", error);
                    throw new Error("Authentication failed.");
                }
            }
        },
        isTokenBlacklisted: {
            params: {
                token: "string"
            },
            async handler(ctx) {
                return this.isTokenBlacklisted(ctx.params.token);
            }
        },

        logout: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/user/logout"
            },
            async handler(ctx) {
                const { _id, token } = ctx.meta;

                try {
                    // Revoke the refresh token
                    await this.revokeOldRefreshToken(_id);

                    // Blacklist the access token
                    const decoded = jwt.decode(token);
                    if (decoded && decoded.exp) {
                        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
                        if (expiresIn > 0) {
                            await this.addAccessTokenToBlacklist(token, expiresIn);
                        }
                    }

                    return { success: true, message: "Logged out successfully." };
                } catch (error) {
                    this.logger.error("Logout error:", error);
                    throw new Error("Logout failed.");
                }
            }
        },

        /**
         * POST: /user/change-password
         * Change user password after verifying current password.
         */
        changePassword: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/user/change-password"
            },
            params: {
                currentPassword: "string",
                newPassword: "string"
            },
            async handler(ctx) {
                try {
                    const { currentPassword, newPassword } = ctx.params;
                    const userId = ctx.meta._id;

                    // Find the user by ID
                    const user = await this.adapter.findById(userId);
                    if (!user) {
                        return { 
                            success: false, 
                            message: "User not found." 
                        };
                    }

                    // Check if user has a password set
                    if (!user.password) {
                        return { 
                            success: false, 
                            message: "User does not have a password set. Please use set-password instead." 
                        };
                    }

                    // Verify the current password
                    const isCurrentPasswordValid = await comparePassword(user.password, currentPassword);
                    if (!isCurrentPasswordValid) {
                        return { 
                            success: false, 
                            message: "Current password is incorrect." 
                        };
                    }

                    // Hash the new password
                    const hashedNewPassword = await hashPassword(newPassword);

                    // Update the password
                    await this.adapter.updateById(userId, { 
                        $set: { 
                            password: hashedNewPassword, 
                            updated_at: new Date() 
                        } 
                    });

                    // Send email notification
                    ctx.call("email.send", {
                        to: user.email,
                        subject: "Your FlowFlex.ai Password Has Been Changed",
                        text: `Hi ${user.full_name},\n\nYour FlowFlex.ai password has been successfully changed.\n\nIf you did not request this change, please contact our support team immediately.\n\nBest regards,\nThe FlowFlex.ai Team`,
                        html: `<p>Hi ${user.full_name},</p><p>Your FlowFlex.ai password has been successfully changed.</p><p>If you did not request this change, please contact our support team immediately.</p><p>Best regards,<br>The FlowFlex.ai Team</p>`
                    }).then(res => {
                        console.log("Password change notification email sent", res);
                    }).catch(err => {
                        console.error("Failed to send password change notification email", err);
                    });

                    // Send WhatsApp notification if phone number exists
                    if (user.phone_number) {
                        ctx.call("whatsapp.sendMessage", {
                            to: user.phone_number,
                            body: {
                                name: "password_change",
                                "language": {
                                    "code": "en"
                                },
                                components: [
                                    {
                                        type: "body",
                                        parameters: [
                                            {
                                                type: "text",
                                                text: user.full_name
                                            }
                                        ]
                                    }
                                ]
                            },
                            type: "template"
                        }).then(res => {
                            console.log("Password change WhatsApp message sent", res);
                        }).catch(err => {
                            console.error("Failed to send password change WhatsApp message", err);
                        });
                    }

                    return { 
                        success: true, 
                        message: "Password changed successfully." 
                    };
                } catch (error) {
                    this.logger.error("Change password error:", error);
                    return { 
                        success: false, 
                        message: "Failed to change password. Please try again." 
                    };
                }
            }
        },

        async confirmEmailVerification(ctx) {
            const { email, type } = ctx.params;
            // Check if the user exists
            const user = await this.adapter.findOne({ email });
            if (!user) {
                return { success: false, message: "User not found." };
            }
            // Check if the email is already verified
            if (user.email_verified && type === "account_creation") {
                return { success: false, message: "Email already verified." };
            }
            console.log("user details", user);
            // Update the user's email_verified status
            await this.adapter.updateById(user._id, { $set: { email_verified: true } });
            // Optionally, you can send a confirmation email here

            return { success: true, message: "Email verified successfully." };
        },

        async checkEmailAlreadyVerified(ctx) {
            const { email, type } = ctx.params;
            // Check if the user exists
            const user = await this.adapter.findOne({ email });
            if (!user) {
                return { success: false, message: "User not found!" };
            }
            // Check if the email is already verified
            if (type == "reset_password") {
                return { success: true, message: "Email not verified." };
            }
            if (user.email_verified) {
                return { success: false, message: "Email already verified." };
            }

            return { success: true, message: "Email not verified." };
        },


        // Refresh Token Method
        async refreshToken(ctx) {
            const { rt } = ctx.params;
            try {
                // Verify the refresh token
                const decoded = jwt.verify(rt, process.env.REFRESH_TOKEN_SECRET);
                const { _id, app_id, org_id } = decoded;
                ctx.meta._id = _id;
                ctx.meta.org_id = org_id;
                const userScopes = await ctx.call("ums_roles.getUserScopes", { org_id });
                if (!userScopes) {
                    throw new Error("User scopes not found");
                }
                const scopes = userScopes.data;

                // Check if the refresh token is valid by checking Redis
                const storedToken = await this.getRefreshToken(_id);
                if (storedToken !== rt) {
                    throw new Error("Refresh token expired or invalid");
                }

                // Generate a new access token
                const newAccessToken = jwt.sign({ _id, app_id, org_id, scopes }, process.env.JWT_SECRET, { expiresIn: "1d" });

                return { success: true, message: "Token refreshed", data: newAccessToken };
            } catch (error) {
                console.error("Error refreshing token:", error);
                if (error.name === "TokenExpiredError") {
                    return { success: false, message: "Refresh token has expired." };
                }
                throw new UnAuthorizedError();
            }
        },

        /**
         * POST: /user/archive
         * Archive a user in the current organization (Admin only).
         */
        archiveUser: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/user/archive"
            },
            params: {
                user_id: "string"
            },
            async handler(ctx) {
                try {
                    // Check if the user has full_control scope (admin only)
                    if (!ctx.meta.scopes.includes("full_control")) {
                        throw new Error("Permission denied: Only admin users can archive users");
                    }

                    const { user_id } = ctx.params;
                    const { org_id } = ctx.meta;

                    // Prevent self-archiving
                    if (user_id === ctx.meta._id) {
                        throw new Error("Cannot archive yourself");
                    }

                    // Check if the target user exists in the current organization
                    const userOrg = await user_organisationsModel.findOne({
                        user_id,
                        org_id,
                        status: { $ne: "Archived" }
                    });

                    if (!userOrg) {
                        throw new Error("User not found in this organization or already archived");
                    }

                    // Archive the user in the current organization
                    await user_organisationsModel.findByIdAndUpdate(userOrg._id, {
                        $set: {
                            status: "Archived",
                            updated_at: new Date()
                        }
                    });

                    // Get updated user organization data
                    const updatedUserOrg = await user_organisationsModel.findById(userOrg._id)
                        .populate('user_id', '-password -__v')
                        .populate('org_id')
                        .populate('role');

                    return {
                        success: true,
                        message: "User archived successfully",
                        data: updatedUserOrg
                    };
                } catch (error) {
                    this.logger.error("Archive user error:", error);
                    throw new Error(error.message || "Failed to archive user");
                }
            }
        },

        /**
         * POST: /user/unarchive
         * Unarchive a user in the current organization (Admin only).
         */
        unarchiveUser: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/user/unarchive"
            },
            params: {
                user_id: "string"
            },
            async handler(ctx) {
                try {
                    // Check if the user has full_control scope (admin only)
                    if (!ctx.meta.scopes.includes("full_control")) {
                        throw new Error("Permission denied: Only admin users can unarchive users");
                    }

                    const { user_id } = ctx.params;
                    const { org_id } = ctx.meta;

                    // Check if the target user exists and is archived in the current organization
                    const userOrg = await user_organisationsModel.findOne({
                        user_id,
                        org_id,
                        status: "Archived"
                    });

                    if (!userOrg) {
                        throw new Error("User not found in this organization or not archived");
                    }

                    // Unarchive the user in the current organization
                    await user_organisationsModel.findByIdAndUpdate(userOrg._id, {
                        $set: {
                            status: "Active",
                            updated_at: new Date()
                        }
                    });

                    // Get updated user organization data
                    const updatedUserOrg = await user_organisationsModel.findById(userOrg._id)
                        .populate('user_id', '-password -__v')
                        .populate('org_id')
                        .populate('role');

                    return {
                        success: true,
                        message: "User unarchived successfully",
                        data: updatedUserOrg
                    };
                } catch (error) {
                    this.logger.error("Unarchive user error:", error);
                    throw new Error(error.message || "Failed to unarchive user");
                }
            }
        },

        /**
         * GET: /user/archive-status
         * Get the archive status of a user across all organizations.
         */
        getUserArchiveStatus: {
            auth: "required",
            rest: {
                method: "GET",
                path: "/user/archive-status"
            },
            params: {
                user_id: "string"
            },
            async handler(ctx) {
                try {
                    const { user_id } = ctx.params;
                    const { org_id } = ctx.meta;

                    // Check if the requesting user has full_control scope (admin only)
                    if (!ctx.meta.scopes.includes("full_control")) {
                        throw new Error("Permission denied: Only admin users can view archive status");
                    }

                    // Get user's status across all organizations
                    const userOrgs = await user_organisationsModel.find({ user_id })
                        .populate('org_id', 'name')
                        .populate('role', 'name')
                        .select('org_id role status created_at updated_at');

                    // Group by status
                    const statusGroups = {
                        Active: [],
                        Archived: [],
                        Invited: [],
                        Rejected: []
                    };

                    userOrgs.forEach(userOrg => {
                        const orgData = {
                            organization: userOrg.org_id,
                            role: userOrg.role,
                            status: userOrg.status,
                            added_at: userOrg.created_at,
                            last_updated: userOrg.updated_at
                        };
                        statusGroups[userOrg.status].push(orgData);
                    });

                    return {
                        success: true,
                        message: "User archive status retrieved successfully",
                        data: {
                            user_id,
                            status_summary: {
                                total_organizations: userOrgs.length,
                                active_organizations: statusGroups.Active.length,
                                archived_organizations: statusGroups.Archived.length,
                                invited_organizations: statusGroups.Invited.length,
                                rejected_organizations: statusGroups.Rejected.length
                            },
                            organizations_by_status: statusGroups
                        }
                    };
                } catch (error) {
                    this.logger.error("Get user archive status error:", error);
                    throw new Error(error.message || "Failed to retrieve user archive status");
                }
            }
        },

        // Helper functions for handling Redis refresh tokens
        async storeRefreshToken(ctx) {
            const { _id, refreshToken, ttl } = ctx.params;
            return new Promise((resolve, reject) => {
                redis.set(_id, refreshToken, "EX", 86400 * ttl, (err) => {
                    if (err) {
                        console.error(err);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        },

    },
    methods: {
        /**
         * Check if a user is archived in a specific organization
         * @param {string} userId - The user ID to check
         * @param {string} orgId - The organization ID to check
         * @returns {boolean} - True if user is archived, false otherwise
         */
        async isUserArchivedInOrg(userId, orgId) {
            try {
                const userOrg = await user_organisationsModel.findOne({
                    user_id: userId,
                    org_id: orgId
                });

                return userOrg ? userOrg.status === "Archived" : false;
            } catch (error) {
                this.logger.error("Error checking user archive status:", error);
                return false;
            }
        },

        async getRefreshToken(userId) {
            return new Promise((resolve, reject) => {
                redis.get(userId, (err, result) => {
                    if (err) reject(err);
                    resolve(result);
                });
            });
        },

        async revokeOldRefreshToken(userId) {
            return new Promise((resolve, reject) => {
                redis.del(userId, (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
        },
        async addAccessTokenToBlacklist(token, expiresIn) {
            return new Promise((resolve, reject) => {
                redis.set(`blacklist:${token}`, "true", "EX", expiresIn, (err) => {
                    if (err) {
                        console.error(err);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        },

        async isTokenBlacklisted(token) {
            return new Promise((resolve, reject) => {
                redis.get(`blacklist:${token}`, (err, result) => {
                    if (err) {
                        console.error(err);
                        reject(err);
                    } else {
                        resolve(result === "true");
                    }
                });
            });
        }
    },

    async afterConnected() {
        this.logger.info("Connected to MongoDB!");
    }
};
