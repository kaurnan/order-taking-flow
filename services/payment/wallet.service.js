"use strict";

const DbMixin = require("../../mixins/db.mixin");
const mongoose = require("mongoose");


module.exports = {
    name: "wallet",
    mixins: [DbMixin("wallet")],
    settings: {
        // Add service settings here if needed
    },
    actions: {
        /**
         * Init wallet for an organisation, this is called when an organisation is created
         * Dont delete this action
         */
        init: {
            rest: "POST /init",
            params: {
                org_id: "string",
                min_balance: { type: "number", positive: true, convert: true },
                balance: { type: "number", convert: true }, // Allow negative values
                currency: { type: "string", optional: true },
                userId: { type: "string", optional: true }
            },
            async handler(ctx) {
                let entity = ctx.params;
                entity.createdAt = new Date();
                entity.updatedAt = new Date();
                entity.org_id = new mongoose.Types.ObjectId(entity.org_id);
                entity.threshold = 5;
                entity.lastRechargeAmount = entity.balance; // Set initial recharge amount
                entity.usageSinceLastRecharge = 0; // Reset usage on init
                console.log("wallet init payload", entity);
                const _wallet = await this.adapter.insert(entity);
                console.log("helppppp", {
                    _id: entity.org_id.toString(),
                    wallet: _wallet._id.toString()
                });
                await ctx.call("ums_organisation.updateOrg", {
                    _id: entity.org_id.toString(),
                    wallet: _wallet._id.toString()
                });
                return _wallet;
            }
        },

        /**
         * Recharge wallet when a payment is successful
         */
        rechargeWallet: {
            rest: "PUT /recharge",
            params: {
                org_id: "string",
                amount: { type: "number", positive: true, convert: true }
            },
            async handler(ctx) {
                const { org_id, amount } = ctx.params;
                const wallet = await this.adapter.findOne({ org_id: new mongoose.Types.ObjectId(org_id) });

                if (!wallet) {
                    throw new Error("Wallet not found for the given organisation ID.");
                }

                wallet.balance += amount;
                wallet.lastRechargeAmount = amount; // Set last recharge amount to the new recharge
                wallet.usageSinceLastRecharge = 0; // Reset usage on recharge
                wallet.total_recharged += amount; // Increment total_recharged
                wallet.updatedAt = new Date();

                await this.adapter.updateById(wallet._id, { $set: wallet });

                // Emit an event for email notification
                this.broker.emit("wallet.rechargeEmail", {
                    org_id: org_id,
                    userId: ctx.meta.userId || "",
                    amount: amount,
                    currency: wallet.currency || "INR",
                    balance: wallet.balance,
                    additional_email: wallet.additional_email // Pass additional emails from wallet
                });

                return {
                    success: true,
                    message: "Wallet recharged successfully.",
                    data: wallet
                };
            }
        },

        /**
         * Initiate PhonePe wallet recharge
         */
        initiatePhonePeRecharge: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/phonepe/recharge"
            },
            params: {
                amount: { type: "number", positive: true, convert: true },
                currency: { type: "string", optional: true, default: "INR" },
                redirectUrl: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { amount, currency, redirectUrl } = ctx.params;
                const { org_id } = ctx.meta;

                // Validate wallet exists
                const wallet = await this.adapter.findOne({ org_id: new mongoose.Types.ObjectId(org_id) });
                if (!wallet) {
                    throw new Error("Wallet not found for the given organisation ID.");
                }

                // Validate amount
                if (amount < 1) {
                    throw new Error("Minimum recharge amount is 1");
                }

                // Call PhonePe service to initiate payment
                const paymentResult = await ctx.call("phonepe.initiateWalletRecharge", {
                    amount,
                    currency,
                    redirectUrl
                });

                return {
                    success: true,
                    message: "PhonePe recharge initiated successfully",
                    data: {
                        ...paymentResult.data,
                        wallet_balance: wallet.balance,
                        wallet_id: wallet._id
                    }
                };
            }
        },

        /**
         * Initiate Razorpay wallet recharge
         */
        initiateRazorpayRecharge: {
            auth: "required",
            rest: {
                method: "POST",
                path: "/razorpay/recharge"
            },
            params: {
                amount: { type: "number", positive: true, convert: true },
                currency: { type: "string", optional: true, default: "INR" },
                redirectUrl: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { amount, currency, redirectUrl } = ctx.params;
                const { org_id } = ctx.meta;

                // Validate wallet exists
                const wallet = await this.adapter.findOne({ org_id: new mongoose.Types.ObjectId(org_id) });
                if (!wallet) {
                    throw new Error("Wallet not found for the given organisation ID.");
                }

                // Validate amount
                if (amount < 1) {
                    throw new Error("Minimum recharge amount is 1");
                }

                // Call Razorpay service to initiate payment
                const paymentResult = await ctx.call("razorpay.initiateWalletRecharge", {
                    amount,
                    currency,
                    redirectUrl
                });

                return {
                    success: true,
                    message: "Razorpay recharge initiated successfully",
                    data: {
                        ...paymentResult.data,
                        wallet_balance: wallet.balance,
                        wallet_id: wallet._id
                    }
                };
            }
        },

        /**
         * Deduct from wallet
         */
        deductFromWallet: {
            rest: "PUT /deduct",
            params: {
                org_id: "string",
                amount: { type: "number", positive: true, convert: true }
            },
            async handler(ctx) {
                const { org_id, amount } = ctx.params;
                const wallet = await this.adapter.findOne({ org_id: new mongoose.Types.ObjectId(org_id) });

                if (!wallet) {
                    throw new Error("Wallet not found for the given organisation ID.");
                }

                if (wallet.balance < amount) {
                    throw new Error("Insufficient balance.");
                }

                wallet.balance -= amount;
                wallet.usageSinceLastRecharge += amount;
                wallet.total_usage += amount; // Increment total_usage
                wallet.updatedAt = new Date();

                await this.adapter.updateById(wallet._id, { $set: wallet });

                return {
                    success: true,
                    message: "Amount deducted successfully.",
                    data: wallet
                };
            }
        },

        /**
         * Get wallet details by organisation ID
         */
        getWalletByOrgId: {
            auth: "required",
            rest: "GET /:org_id",
            params: {},
            async handler(ctx) {
                const { org_id } = ctx.meta;
                const wallet = await this.adapter.findOne({ org_id: new mongoose.Types.ObjectId(org_id) });
                if (!wallet) {
                    throw new Error("Wallet not found for the given organisation ID.");
                }
                let usagePercentage = 0;
                if (wallet.lastRechargeAmount > 0) {
                    usagePercentage = (wallet.usageSinceLastRecharge / wallet.lastRechargeAmount) * 100;
                }
                return {
                    success: true,
                    message: "Wallet details retrieved successfully.",
                    data: {
                        ...wallet._doc,
                        currentBalance: wallet.balance,
                        lastRechargeAmount: wallet.lastRechargeAmount,
                        usageSinceLastRecharge: wallet.usageSinceLastRecharge,
                        usagePercentage: parseFloat(usagePercentage.toFixed(2)),
                        monthlyUsage: wallet.monthlyUsage
                    }
                };
            }
        },

        /**
         * Update wallet threshold limit
         */
        updateWalletThreshold: {
            auth: "required",
            rest: "PUT /threshold",
            params: {
                new_limit: { type: "number", positive: true, convert: true },
                additional_email: { type: "array", items: "string", optional: true, default: [] },
                phone: { type: "array", items: "string", optional: true, default: [] }
            },
            async handler(ctx) {
                const { org_id } = ctx.meta;
                const { new_limit, additional_email, phone } = ctx.params;

                const wallet = await this.adapter.findOne({ org_id: new mongoose.Types.ObjectId(org_id) });

                if (!wallet) {
                    throw new Error("Wallet not found for the given organisation ID.");
                }

                wallet.threshold = new_limit;
                wallet.additional_email = additional_email;
                wallet.phone = phone;
                wallet.updatedAt = new Date();

                await this.adapter.updateById(wallet._id, { $set: wallet });

                return {
                    success: true,
                    message: "Wallet threshold updated successfully.",
                    data: wallet
                };
            }
        }
    },
    dependencies: [],
    events: {
        // Add event handlers here if needed
    },
    methods: {
        async setupWalletChangeStream() {
            try {
                const WalletCollection = this.adapter.model.collection;
                if (!WalletCollection) {
                    this.logger.error("Collection 'wallets' is not defined.");
                    return;
                }

                // Close existing stream if it exists
                if (this.walletChangeStream) {
                    try {
                        this.walletChangeStream.close();
                    } catch (closeError) {
                        this.logger.error("Error closing existing Wallet ChangeStream:", closeError);
                    }
                }

                this.walletChangeStream = WalletCollection.watch([
                    {
                        $match: {
                            operationType: "update",
                            "updateDescription.updatedFields.balance": { $exists: true }
                        }
                    }
                ], { fullDocument: "updateLookup" });

                this.walletChangeStream.on("change", async (change) => {
                    this.logger.info("Wallet change detected:", change);
                    try {
                        const wallet = change.fullDocument;
                        if (wallet && wallet.balance !== undefined && wallet.threshold !== undefined) {
                            if (wallet.balance < wallet.threshold) {
                                this.logger.warn(`Wallet balance for org_id ${wallet.org_id} is below threshold! Balance: ${wallet.balance}, Threshold: ${wallet.threshold}`);
                                await this.sendLowBalanceAlert(wallet);
                            }
                        }
                    } catch (error) {
                        this.logger.error("Error processing wallet change:", error);
                    }
                });

                this.walletChangeStream.on("error", (error) => {
                    this.logger.error("Wallet ChangeStream error:", error);
                    // Implement reconnection logic if necessary
                });

                this.walletChangeStream.on("close", () => {
                    this.logger.info("Wallet ChangeStream closed, attempting to reconnect...");
                    // Implement reconnection logic here, e.g., setTimeout(() => this.setupWalletChangeStream(), 5000);
                });

                this.logger.info("Wallet ChangeStream setup completed successfully.");

            } catch (error) {
                this.logger.error("Error setting up Wallet ChangeStream:", error);
            }
        },

        async sendLowBalanceAlert(wallet) {
            const { org_id, balance, threshold, additional_email, phone } = wallet;
            const subject = `Low Wallet Balance Alert for Organisation: ${org_id}`;
            const emailText = `Dear User,\n\nYour wallet balance is currently ${balance}, which is below your set threshold of ${threshold}.\nPlease recharge your wallet to avoid service interruptions.\n\nRegards,\nFlowflex Team`;
            const emailHtml = `<p>Dear User,</p><p>Your wallet balance is currently <strong>${balance}</strong>, which is below your set threshold of <strong>${threshold}</strong>.</p><p>Please recharge your wallet to avoid service interruptions.</p><p>Regards,<br/>Flowflex Team</p>`;

            // Send email notifications
            if (additional_email && additional_email.length > 0) {
                for (const email of additional_email) {
                    try {
                        await this.broker.call("email.send", {
                            to: email,
                            subject: subject,
                            text: emailText,
                            html: emailHtml
                        });
                        this.logger.info(`Low balance email sent to ${email} for org ${org_id}`);
                    } catch (error) {
                        this.logger.error(`Failed to send low balance email to ${email}:`, error.message || error);
                    }
                }
            } else {
                this.logger.info(`No additional emails configured for org ${org_id} to send low balance alert.`);
            }

            // Send WhatsApp notifications
            if (phone && phone.length > 0) {
                for (const phoneNumber of phone) {
                    try {

                        this.broker.call("whatsapp.sendMessage", {
                            to: phoneNumber,
                            body: {
                                name: "wallet_balance_low",
                                "language": {
                                    "code": "en"
                                },
                                components: [
                                    {
                                        type: "body",
                                        parameters: [
                                            {
                                                type: "text",
                                                text: `$${balance}`
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
                        this.logger.info(`Low balance WhatsApp message sent to ${phoneNumber} for org ${org_id}`);
                    } catch (error) {
                        this.logger.error(`Failed to send low balance WhatsApp message to ${phoneNumber}:`, error.message || error);
                    }
                }
            } else {
                this.logger.info(`No phone numbers configured for org ${org_id} to send low balance WhatsApp alert.`);
            }
        }
    },
    created() {
        // Lifecycle event handler
    },
    async started() {
        this.setupWalletChangeStream();
        this.logger.info("Wallet service started with change stream.");
    },
    stopped() {
        if (this.walletChangeStream) {
            try {
                this.walletChangeStream.close();
            } catch (closeError) {
                this.logger.error("Error closing Wallet ChangeStream on service stop:", closeError);
            }
        }
        this.logger.info("Wallet service stopped.");
    }
};
