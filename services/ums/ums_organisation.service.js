"use strict";

const { generateTokens } = require("../../utils/helpers");
const dbMixin = require("../../mixins/db.mixin");
const mongoose = require("mongoose");
const organisationModel = require("../../models/ums/organisation.model");
const Pricing = require("../../models/pricing.model");
const { ObjectId } = require("mongodb");
const user_organisationsModel = require("../../models/ums/user_organisations.model");
const rolesModel = require("../../models/ums/roles.model");
const scopesModel = require("../../models/ums/scopes.model");

module.exports = {
    name: "ums_organisation",
    mixins: [dbMixin("ums/organisation")],
    model: organisationModel,
    settings: {
        fields: ["_id", "app_id", "name", "website", "country", "currency", "business_address", "meta"]
    },

    actions: {

        /**
         * POST: /organisation
         * Create a new organisation.
         */
        create: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/organisation"
            },
            params: {
                name: "string",
                website: "string",
                country: "string",
                currency: "string",
                business_address: {
                    type: "object",
                    props: {
                        address1: "string",
                        state: "string",
                        city: "string",
                        zip: "string"
                    }
                },
                meta: { type: "object", optional: true },
                wallet: { type: "string", optional: true },
                channels: { type: "array", items: "string", optional: true },
                branches: { type: "array", items: "string", optional: true },
                profile_image: { type: "string", optional: true },
                def_notify_email: { type: "email", optional: true },
                def_notify_whatsapp: { type: "string", optional: true }
            },
            async handler(ctx) {
                const growthPlan = await Pricing.findOne({ slug: "growth", billing_cycle: "quarterly" });
                if (!growthPlan) {
                    throw new Error("Growth Plan (quarterly) not found in pricing data.");
                }

                const trialEndDate = new Date();
                trialEndDate.setDate(trialEndDate.getDate() + growthPlan.trial_days);

                const organisation = await this.adapter.insert({
                    ...ctx.params,
                    wallet: null,
                    branches: [],
                    profile_image: null,
                    def_notify_email: null,
                    def_notify_whatsapp: null,
                    plan: growthPlan,
                    trial_end_date: trialEndDate,
                    gcp_regions: ["asia-southeast1", "asia-southeast2", "asia-east1"], // Default GCP regions
                });
                if (!organisation) {
                    throw new Error("Failed to create organisation");
                }
                await ctx.call("wallet.init", { org_id: organisation._id.toString(), min_balance: 5, balance: 0, currency: ctx.params.currency });
                await ctx.call("branch.init", { org_id: organisation._id.toString(), name: "Default Branch" });
                await ctx.call("getstarted.InitializeGetStarted", { org_id: organisation._id.toString() });

                const userOrg = await ctx.call("ums_user_organisations.create", {
                    user_id: ctx.meta._id,
                    org_id: organisation._id.toString(),
                    role: "admin"
                });

                if (!userOrg) {
                    throw new Error("Failed to create user organisation association");
                }
                const userDetails = await ctx.call("ums_user.get", { id: ctx.meta._id });
                console.log("userDetails", userDetails);
                ctx.call("email.send", {
                    to: userDetails.email,
                    subject: "Organisation Created Successfully",
                    text: `Dear ${userDetails.full_name},\n\nYour organisation "${organisation.name}" has been created successfully.\n\nThank you for using our service.`,
                    html: `<p><img src="https://storage.googleapis.com/flowflex_bucket/Flowflex%20notifications/B18.png" alt="Header Image" style="max-width: 100%; height: auto;"></p>
                           <p>Dear ${userDetails.full_name},</p>
                           <p>Your organisation "<strong>${organisation.name}</strong>" has been created successfully.</p>
                           <p>Thank you for using our service.</p>`
                }).then(res => {
                    console.log("Organisation creation email sent", res);
                }).catch(err => {
                    console.error("Failed to send organisation creation email", err);
                });
                ctx.call("whatsapp.sendMessage", {
                    to: userDetails.phone_number,
                    body: {
                        name: "account_created",
                        "language": {
                            "code": "en"
                        },
                        components: [
                            {
                                type: "header",
                                parameters: [
                                    {
                                        type: "image",
                                        image: {
                                            link: "https://storage.googleapis.com/flowflex_bucket/Flowflex%20notifications/B18.png"
                                        }
                                    }
                                ]
                            },
                            {
                                type: "body",
                                parameters: [
                                    {
                                        type: "text",
                                        text: userDetails.full_name
                                    },
                                    {
                                        type: "text",
                                        text: userDetails.email
                                    }
                                ]
                            }
                        ]
                    },
                    type: "template"
                }).then(res => {
                    console.log("Whatsapp notification sent", res);
                }).catch(err => {
                    console.error("Failed to send whatsapp notification", err);
                });
                // Emit organisation created event
                await ctx.emit("ums_organisation.created", organisation);

                return {
                    message: "Organisation created successfully",
                    data: organisation
                };
            }
        },

        updateOrg: {
            params: {
                _id: "string",
                name: { type: "string", optional: true },
                country: { type: "string", optional: true },
                currency: { type: "string", optional: true },
                wallet: { type: "string", optional: true },
                channels: { type: "array", items: "string", optional: true },
                branches: { type: "array", items: "string", optional: true },
                profile_image: { type: "string", optional: true },
                def_notify_email: { type: "email", optional: true },
                def_notify_whatsapp: { type: "string", optional: true },
                waba_id: { type: "string", optional: true },
            },
            async handler(ctx) {
                console.log("Updating organisation with ID:", ctx.params._id);
                const { _id, branches, channels, wallet, ...updateData } = ctx.params; // Exclude _id from being updated
                const organisation = await this.adapter.findById(_id);
                if (wallet) {
                    updateData.wallet = new mongoose.Types.ObjectId(wallet);
                }

                // Add new branches to the existing branches array
                if (branches) {
                    const existingBranches = organisation.branches || [];
                    const newBranches = branches.map(branch => new mongoose.Types.ObjectId(branch));
                    updateData.branches = [...new Set([...existingBranches, ...newBranches])]; // Merge and remove duplicates
                }

                if (channels) {
                    const existingChannels = organisation.channels || [];
                    const newChannels = channels.map(channel => new mongoose.Types.ObjectId(channel));
                    updateData.channels = [...new Set([...existingChannels, ...newChannels])]; // Merge and remove duplicates
                }

                return await this.adapter.updateById(_id, { $set: updateData });
            }
        },

        updateProfileImage: {
            auth: "required",
            rest: {
                method: "PUT",
                path: "/organisation/profile-image"
            },
            params: {
                profile_image: "string"
            },
            async handler(ctx) {
                const { org_id } = ctx.meta;
                const { profile_image } = ctx.params;
                const organisation = await this.adapter.findById(org_id);
                if (!organisation) {
                    throw new Error("Organisation not found");
                }
                await this.adapter.updateById(org_id, { $set: { profile_image } });
                return {
                    success: true,
                    message: "Profile updated successfully",
                    data: {
                        profile_image
                    }
                };
            }
        },

        getOrg: {
            auth: "required",
            rest: {
                method: "GET",
            },
            async handler(ctx) {
                const org = await this.adapter.findById(ctx.meta.org_id);
                if (!org) {
                    throw new Error("Organisation not found");
                }
                return {
                    status: true,
                    message: "Organisation fetched successfully",
                    data: org
                };
            }
        },

        /**
         * GET:ID /switchOrganisation
         * select organisation after logged in and the organisationid params
         */
        switchOrganisation: {
            rest: {
                method: "GET",
                path: "/switch-org/:id"
            },
            auth: "required",
            params: {
                id: "string",
            },
            async handler(ctx) {
                try {
                    const { id } = ctx.params;
                    const OrgId = new ObjectId(id);
                    const UserId = new ObjectId(ctx.meta._id);

                    // Find user organization with status check
                    const ums_userOrg = await user_organisationsModel.findOne({
                        org_id: OrgId,
                        user_id: UserId
                    }).populate({
                        path: "role",
                        model: rolesModel,
                        populate: {
                            path: "scopes",
                            model: scopesModel
                        }
                    });

                    if (!ums_userOrg) {
                        throw new Error("Organisation not found");
                    }

                    // Check if user is archived in this organization
                    if (ums_userOrg.status === "Archived") {
                        throw new Error("Access denied: User is archived in this organization");
                    }

                    const userRole = ums_userOrg.role;
                    if (!userRole) {
                        throw new Error("User role not found");
                    }

                    const tokens = generateTokens({
                        _id: ctx.meta._id,
                        org_id: id,
                        scopes: userRole?.scopes?.map(scope => scope.access),
                        ttl: ctx.meta.ttl
                    });

                    await ctx.call("ums_user.storeRefreshToken", {
                        _id: ctx.meta._id,
                        refreshToken: tokens.refreshToken,
                        ttl: ctx.meta.ttl
                    });

                    return {
                        message: "Organisation switched successfully",
                        access_token: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        status: true
                    };
                } catch (error) {
                    this.logger.error("Switch organisation error:", error);
                    throw new Error(error.message || "Failed to switch organisation");
                }
            },
        },

        getUserConfig: {
            cache: {
                enabled: ctx => ctx.params.noCache !== true,
                ttl: 5
            },
            auth: "required",
            rest: {
                method: "GET",
                path: "/user-config"
            },
            async handler(ctx) {
                const org = await this.adapter.model.findById(ctx.meta.org_id).populate({
                    path: "plan",
                    model: Pricing
                });
                const user_orgs = await ctx.call("ums_user_organisations.listOrganisations");
                const user = await ctx.call("ums_user.get", { id: ctx.meta._id });
                const userBranches = await ctx.call("branch.listBranchesByOrgId", { org_id: ctx.meta.org_id, pageSize: 100 });
                if (!org) {
                    throw new Error("Organisation not found");
                }
                return {
                    status: true,
                    message: "Organisation config fetched successfully",
                    data: {
                        user_org: org,
                        user_data: user,
                        user_branches: userBranches?.data ?? [],
                        user_orgs: user_orgs?.data ?? [],
                    }
                };
            }
        },

        umsListOrganisations: {
            rest: {
                method: "GET",
                path: "/orgs"
            },
            async handler(ctx) {
                const userOrgs = await this.adapter.model.find({});
                return userOrgs;
            }
        }
    },

    async afterConnected() {
        this.logger.info("Connected to MongoDB!");
    }
};
