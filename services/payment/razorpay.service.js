const Razorpay = require("razorpay");
const dbMixin = require("../../mixins/db.mixin");
const paymentUtils = require("../../utils/payment.utils");
const { validateWebhookSignature } = require("razorpay/dist/utils/razorpay-utils");

"use strict";

/**
 * Initializes a new instance of the Razorpay client with the provided credentials.
 *
 * @constant
 * @type {Razorpay}
 * @name razorpay
 * @description
 * This Razorpay client instance is configured using environment variables for secure access.
 * - `key_id`: The public API key for authenticating requests to Razorpay.
 * - `key_secret`: The secret key for authorizing sensitive operations.
 *
 * @example
 * // Access the Razorpay client to create a new payment order
 * const order = await razorpay.orders.create({ amount: 50000, currency: "INR" });
 *
 * @see {@link https://razorpay.com/docs/api/} for more details on available methods and usage.
 *
 * @note
 * Ensure that `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set in your environment variables
 * for secure and seamless integration in production environments.
 */
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "placeholder_secret"
});

module.exports = {
    name: "razorpay",
    mixins: [dbMixin("transaction")],
    settings: {
        fields: ["_id", "amount", "type", "status", "org_id", "userId", "payment_gateway", "gateway_transaction_id", "merchant_order_id", "createdAt", "updatedAt"]
    },
    actions: {
        initiateWalletRecharge: {
            auth: "required",
            params: {
                amount: { type: "number", positive: true, convert: true },
                currency: { type: "string", optional: true, default: "INR" },
                redirectUrl: { type: "string", optional: true }
            },

            /**
             * Handles the initiation of a Razorpay wallet recharge.
             *
             * This handler performs the following steps:
             * 1. Validates the recharge amount.
             * 2. Generates a unique merchant order ID.
             * 3. Creates a transaction record in the database.
             * 4. Initiates a Razorpay order for the wallet recharge.
             * 5. Updates the transaction with the Razorpay order details.
             * 6. Returns the order and transaction details for the frontend to proceed with payment.
             * 7. Handles errors by updating the transaction status and sending a failure notification.
             *
             * @async
             * @param {Context} ctx - Moleculer context object.
             * @param {Object} ctx.params - Parameters for the recharge.
             * @param {number} ctx.params.amount - The amount to recharge.
             * @param {string} ctx.params.currency - The currency code (e.g., "INR").
             * @param {string} [ctx.params.redirectUrl] - Optional redirect URL after payment.
             * @param {Object} ctx.meta - Metadata containing user and organization info.
             * @param {string} ctx.meta._id - User ID.
             * @param {string} ctx.meta.org_id - Organization ID.
             * @returns {Promise<Object>} Result object containing success status, message, and payment/order details.
             * @throws {Error} If validation fails, Razorpay order creation fails, or database operations fail.
             */
            async handler(ctx) {
                const { amount, currency, redirectUrl } = ctx.params;
                const { _id: userId, org_id } = ctx.meta;
                const amountValidation = paymentUtils.validateAmount(amount);

                if (!amountValidation.valid) {
                    throw new Error(amountValidation.error);
                }

                // Generate unique merchant order ID
                const merchantOrderId = paymentUtils.generateMerchantOrderId(org_id, "WALLET");
                console.log("merchantOrderId", merchantOrderId.length);

                // Create transaction record
                const transactionData = paymentUtils.createTransactionObject({
                    type: "wallet",
                    amount,
                    description: `Wallet recharge of ${currency} ${amount}`,
                    userId,
                    org_id,
                    payment_gateway: "razorpay",
                    merchant_order_id: merchantOrderId,
                    currency,
                    metadata: paymentUtils.createTransactionMetadata(ctx)
                });

                const transaction = await this.adapter.insert(transactionData);

                try {
                    // Create Razorpay order
                    const orderOptions = {
                        amount: paymentUtils.convertToPaise(amount), // Convert to paise
                        currency: currency,
                        receipt: merchantOrderId,
                        notes: {
                            org_id: org_id,
                            user_id: userId,
                            type: "wallet_recharge"
                        }
                    };

                    const order = await razorpay.orders.create(orderOptions);

                    // Update transaction with gateway response
                    await this.adapter.updateById(transaction._id, {
                        $set: {
                            gateway_order_id: order.id,
                            gateway_response: order,
                            updatedAt: new Date()
                        }
                    });

                    return {
                        success: true,
                        message: "Razorpay recharge initiated successfully",
                        data: {
                            order_id: order.id,
                            amount: order.amount,
                            currency: order.currency,
                            receipt: order.receipt,
                            transaction_id: transaction._id,
                            key_id: process.env.RAZORPAY_KEY_ID,
                            redirect_url: redirectUrl || `${process.env.FRONTEND_URL}/payment/callback`
                        }
                    };
                } catch (error) {
                    // Update transaction status to failed
                    await this.adapter.updateById(transaction._id, {
                        $set: {
                            status: "failed",
                            error_message: error.message,
                            updatedAt: new Date()
                        }
                    });
                    console.log("error", error);

                    // Send failure notification
                    try {
                        await ctx.call("notification.send", {
                            templateKey: "wallet_recharge_failed",
                            variables: {
                                amount: amount,
                                currency: currency,
                                paymentGateway: "Razorpay",
                                merchantOrderId: merchantOrderId,
                                reason: error.message
                            },
                            additionalData: {
                                organisation_id: org_id,
                                user_id: userId,
                                broadcast_type: "org"
                            }
                        });
                    } catch (notifyErr) {
                        this.logger?.error?.("Failed to send failure notification:", notifyErr);
                    }

                    throw new Error(`Failed to create Razorpay order: ${error.message}`);
                }
            }
        },

        handleWebhook: {
            /**
             * Handles incoming Razorpay webhook events.
             *
             * This handler verifies the webhook signature using the raw request body and processes
             * different types of Razorpay webhook events such as `subscription.charged`, `subscription.cancelled`,
             * and payment events. It delegates event-specific logic to corresponding handler methods.
             *
             * @async
             * @param {Context} ctx - Moleculer context object containing webhook payload and metadata.
             * @param {Object} ctx.params - The parsed webhook payload from Razorpay.
             * @param {Object} ctx.meta - Metadata containing the raw request body and Razorpay signature.
             * @param {string} ctx.meta.rawBody - The raw request body as a string, required for signature verification.
             * @param {string} ctx.meta.razorpaySignature - The Razorpay webhook signature from headers.
             * @throws {Error} If the Razorpay signature or raw body is missing, or if signature verification fails.
             * @returns {Promise<Object>} Result object indicating successful processing of the webhook.
             */
            async handler(ctx) {
                const payload = ctx.params;
                const rawBody = ctx.meta.rawBody;

                console.log("=== Webhook Handler Debug ===");
                console.log("Payload:", JSON.stringify(payload, null, 2));
                console.log("Raw body available:", !!rawBody);
                console.log("Raw body type:", typeof rawBody);

                const signature = ctx.meta.razorpaySignature;

                if (!signature) {
                    throw new Error("Missing Razorpay signature");
                }

                if (!rawBody) {
                    throw new Error("Missing raw request body for signature verification");
                }

                // Verify webhook signature using raw body
                const isValid = await this.verifyWebhookSignature(rawBody, signature);
                if (!isValid) {
                    throw new Error("Invalid webhook signature");
                }

                // Handle different webhook payload structures
                const event = payload.event;

                if (event === "subscription.charged") {
                    const subscriptionEntity = payload.payload.subscription.entity;
                    const paymentEntity = payload.payload.payment.entity;
                    await this.handleSubscriptionChargedWebhook(subscriptionEntity, paymentEntity);
                } else if (event === "subscription.cancelled") {
                    const subscriptionEntity = payload.payload.subscription.entity;
                    await this.handleSubscriptionCancelledWebhook(subscriptionEntity);
                } else if (payload.payload.payment && payload.payload.payment.entity && payload.payload.payment.entity.entity === "payment" && payload.event !== "order.paid") {
                    const paymentEntity = payload.payload.payment.entity;
                    await this.handlePaymentWebhook(paymentEntity);
                } else {
                    console.log("No valid entity found in webhook for event:", event);
                }

                return { success: true, message: "Webhook processed successfully" };
            }
        },


        createSubscription: {
            auth: "required",
            params: {
                pricingPlanId: { type: "string" },
                total_count: { type: "number", optional: true, default: 12 }, // Default to 12 months
                quantity: { type: "number", optional: true, default: 1 },
                customer_notify: { type: "boolean", optional: true, default: true },
                start_at: { type: "number", optional: true }, // Unix timestamp
                expire_by: { type: "number", optional: true }, // Unix timestamp
                addons: { type: "array", optional: true, items: "object" },
                offer_id: { type: "string", optional: true },
                notes: { type: "object", optional: true }
            },
            /**
             * Handles the creation of a Razorpay subscription.
             *
             * This method fetches the pricing plan to retrieve the Razorpay plan ID,
             * constructs the subscription options, removes any undefined values to prevent
             * Razorpay API errors, and creates a subscription using the Razorpay SDK.
             * Additional metadata is added to the notes for traceability.
             *
             * @async
             * @param {Context} ctx - Moleculer context object.
             * @param {Object} ctx.params - Parameters for subscription creation.
             * @param {string} ctx.params.pricingPlanId - The ID of the pricing plan to subscribe to.
             * @param {number} [ctx.params.total_count] - Total number of subscription billing cycles.
             * @param {number} [ctx.params.quantity] - Quantity for the subscription.
             * @param {boolean} [ctx.params.customer_notify] - Whether to notify the customer.
             * @param {number} [ctx.params.start_at] - Subscription start timestamp (in seconds).
             * @param {number} [ctx.params.expire_by] - Subscription expiry timestamp (in seconds).
             * @param {Array} [ctx.params.addons] - Addons to be added to the subscription.
             * @param {string} [ctx.params.offer_id] - Offer ID to be applied.
             * @param {Object} [ctx.params.notes] - Additional notes for the subscription.
             * @param {Object} ctx.meta - Metadata from the request context.
             * @param {string} ctx.meta.org_id - Organization ID.
             * @param {string} ctx.meta._id - User ID.
             *
             * @returns {Promise<Object>} Result object containing success status, message, and subscription data.
             *
             * @throws {Error} If the Razorpay plan ID is not found or subscription creation fails.
             */
            async handler(ctx) {
                const { pricingPlanId, total_count, quantity, customer_notify, start_at, expire_by, addons, offer_id, notes } = ctx.params;
                const { org_id, _id: userId } = ctx.meta;

                try {
                    // Fetch pricing plan to get Razorpay plan_id
                    const pricingPlan = await ctx.call("pricing.get", { id: pricingPlanId });

                    if (!pricingPlan || !pricingPlan.plan_id || !pricingPlan.plan_id.razorpay) {
                        throw new Error("Razorpay plan ID not found for the given pricing plan.");
                    }

                    const razorpayPlanId = pricingPlan.plan_id.razorpay;

                    const subscriptionOptions = {
                        plan_id: razorpayPlanId,
                        total_count: total_count,
                        quantity: quantity,
                        customer_notify: customer_notify,
                        start_at: start_at,
                        expire_by: expire_by,
                        addons: addons,
                        offer_id: offer_id,
                        notes: {
                            ...notes,
                            org_id: org_id,
                            user_id: userId,
                            pricing_plan_id: pricingPlanId
                        }
                    };

                    // Remove undefined values to avoid Razorpay API errors
                    Object.keys(subscriptionOptions).forEach(key => {
                        if (subscriptionOptions[key] === undefined) {
                            delete subscriptionOptions[key];
                        }
                    });

                    const subscription = await razorpay.subscriptions.create(subscriptionOptions);

                    // TODO: Store subscription details in your database (e.g., in a new 'subscription' model)
                    // For now, just return the Razorpay response.

                    return {
                        success: true,
                        message: "Razorpay subscription created successfully",
                        data: subscription
                    };

                } catch (error) {
                    this.logger.error("Failed to create Razorpay subscription:", error);
                    throw new Error(`Failed to create Razorpay subscription: ${error.message}`);
                }
            }
        }
    },

    methods: {
        /**
         * Verifies the Razorpay webhook signature to ensure the request's authenticity.
         *
         * @async
         * @param {Object} rawBody - The raw request body received from Razorpay webhook.
         * @param {string} signature - The signature sent by Razorpay in the request headers.
         * @returns {boolean} Returns true if the signature is valid, otherwise false.
         * @throws {Error} Throws an error if the secret is not set or validation fails.
         */
        async verifyWebhookSignature(rawBody, signature) {
            const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
            return validateWebhookSignature(JSON.stringify(rawBody), signature, secret);
        },

        /**
         * Handles the processing of Razorpay payment webhooks.
         *
         * This method performs the following steps:
         * 1. Finds the corresponding transaction using the transaction ID from payment notes.
         * 2. Updates the transaction status and gateway response in the database.
         * 3. If the payment is successful, triggers wallet recharge and sends a success notification.
         * 4. If the payment fails or is cancelled, updates the transaction as failed, fetches wallet info,
         *    and sends failure notifications (including email if available).
         *
         * @async
         * @param {Object} payment - The Razorpay payment entity from the webhook payload.
         * @returns {Promise<void>}
         */
        async handlePaymentWebhook(payment) {
            try {
                // Find transaction by order ID
                const transaction = await this.adapter.findById(payment.notes?.transaction_id);

                if (!transaction) {
                    console.error("Transaction not found for order ID:", payment.order_id);
                    return;
                }

                // Update transaction status
                const status = this.mapRazorpayStatus(payment.status);
                await this.adapter.updateById(transaction._id, {
                    $set: {
                        status: status,
                        gateway_transaction_id: payment.id,
                        gateway_response: payment,
                        updatedAt: new Date()
                    }
                });

                // If payment is successful, update wallet and notify
                if (status === "completed") {
                    await this.handleSuccessfulPayment(transaction, payment);
                } else if (status === "failed" || status === "cancelled") {
                    // Handle failed or cancelled payment: update transaction, fetch wallet, notify
                    try {
                        const orgId = transaction.org_id;
                        const userId = transaction.userId;
                        const currency = transaction.currency ?? "INR";
                        const reason =
                            "Wallet update failed: " +
                            (transaction?.gateway_response?.error_description ?? "Payment failed");

                        // Update transaction status to failed
                        const updatePromise = this.adapter.updateById(transaction._id, {
                            $set: { status: "failed", error_message: reason, updatedAt: new Date() }
                        });

                        // Fetch wallet info for additional email notifications
                        const walletPromise = this.broker
                            .call("wallet.getWalletByOrgId", {}, { meta: { org_id: orgId } })
                            .catch(err => {
                                this.logger?.warn?.("wallet.getWalletByOrgId failed", err);
                                return null;
                            });

                        const [wallet] = await Promise.all([walletPromise, updatePromise]);
                        const additionalEmail = wallet?.data?.additional_email ?? [];

                        // Send failure notifications (event and email)
                        await Promise.allSettled([
                            this.broker.emit("notification.sendEvent", {
                                templateKey: "wallet_recharge_failed",
                                variables: {
                                    amount: transaction.amount,
                                    currency,
                                    paymentGateway: "Razorpay",
                                    merchantOrderId: transaction.merchant_order_id,
                                    reason
                                },
                                additionalData: {
                                    organisation_id: orgId,
                                    user_id: userId,
                                    broadcast_type: "org"
                                }
                            }),
                            this.broker.emit("wallet.rechargeFailedEmail", {
                                org_id: orgId,
                                userId,
                                amount: transaction.amount,
                                currency,
                                merchantOrderId: transaction.merchant_order_id,
                                reason,
                                additional_email: additionalEmail
                            })
                        ]);
                    } catch (err) {
                        this.logger?.error?.("Failed to process wallet recharge failure flow:", err);
                    }
                }
            } catch (error) {
                console.error("Error handling payment webhook:", error);
            }
        },

        /**
         * Maps the given Razorpay payment status to the application's internal payment status.
         *
         * @param {string} razorpayStatus - The payment status received from Razorpay.
         * @returns {string} The mapped internal payment status.
         *
         * @example
         * const status = mapRazorpayStatus('captured');
         * // status might be 'PAID'
         *
         * @see paymentUtils.mapGatewayStatus
         */
        mapRazorpayStatus(razorpayStatus) {
            return paymentUtils.mapGatewayStatus(razorpayStatus, "razorpay");
        },

        /**
         * Handles post-processing after a successful payment transaction.
         *
         * This method performs the following actions:
         * 1. Updates the wallet balance for the organization.
         * 2. Logs the successful wallet recharge.
         * 3. Sends a success notification to the organization.
         * 4. Updates the transaction status to "completed".
         *
         * @async
         * @param {Object} transaction - The transaction object containing payment details.
         * @param {string|number} transaction.org_id - The organization ID.
         * @param {number} transaction.amount - The amount recharged.
         * @param {string} [transaction.currency] - The currency of the transaction (default: "INR").
         * @param {string} transaction.merchant_order_id - The merchant order ID.
         * @param {string|number} transaction.userId - The user ID associated with the transaction.
         * @param {string|number} transaction._id - The unique transaction ID.
         * @param {Object} payment - The payment object (details may vary by gateway).
         * @returns {Promise<void>} Resolves when all operations are completed.
         */
        async handleSuccessfulPayment(transaction, payment) {
            try {
                // Update wallet balance
                await this.broker.call("wallet.rechargeWallet", {
                    org_id: transaction.org_id.toString(),
                    amount: payment.notes.amount
                });

                // Log successful payment
                console.log(`Wallet recharge successful for org ${transaction.org_id}, amount: ${payment.notes.amount}`);

                // Send success notification
                try {
                    await this.broker.call("notification.send", {
                        templateKey: "wallet_recharge_success",
                        variables: {
                            amount: payment.notes.amount,
                            currency: transaction.currency || "INR",
                            paymentGateway: "Razorpay",
                            merchantOrderId: transaction.merchant_order_id
                        },
                        additionalData: {
                            organisation_id: transaction.org_id.toString(),
                            user_id: transaction.userId.toString(),
                            broadcast_type: "org"
                        }
                    });
                } catch (notifyErr) {
                    console.error("Failed to send success notification:", notifyErr);
                }

                // Update transaction status to completed after all successful operations
                await this.adapter.updateById(transaction._id, {
                    $set: {
                        status: "completed",
                        updatedAt: new Date()
                    }
                });
            } catch (error) {
                console.error("Error updating wallet after successful payment:", error);
            }
        },

        /**
         * Handles the Razorpay `subscription.charged` webhook event.
         * 
         * This method performs the following actions:
         * 1. Extracts essential information from the subscription and payment entities.
         * 2. Validates the presence of required notes (org_id, user_id, pricing_plan_id).
         * 3. Records the transaction in the database.
         * 4. Updates the organization's plan details in the user management service.
         * 5. Sends a notification for a successful subscription charge.
         * 
         * @async
         * @param {Object} subscriptionEntity - The Razorpay subscription entity object.
         * @param {string} subscriptionEntity.id - The Razorpay subscription ID.
         * @param {Object} subscriptionEntity.notes - Additional notes containing org_id, user_id, and pricing_plan_id.
         * @param {string} subscriptionEntity.notes.org_id - The organization ID.
         * @param {string} subscriptionEntity.notes.user_id - The user ID.
         * @param {string} subscriptionEntity.notes.pricing_plan_id - The pricing plan ID.
         * @param {number} subscriptionEntity.start_at - Subscription start time (Unix timestamp).
         * @param {number} subscriptionEntity.end_at - Subscription end time (Unix timestamp).
         * @param {string} subscriptionEntity.status - The status of the subscription.
         * @param {Object} paymentEntity - The Razorpay payment entity object.
         * @param {string} paymentEntity.id - The Razorpay payment ID.
         * @param {number} paymentEntity.amount - The payment amount in paise.
         * @param {string} paymentEntity.currency - The payment currency.
         * @param {string} paymentEntity.status - The payment status.
         * @param {string} paymentEntity.order_id - The Razorpay order ID.
         * 
         * @returns {Promise<void>} Resolves when the webhook is handled.
         * 
         * @throws Logs errors if any step fails, but does not throw exceptions.
         */
        async handleSubscriptionChargedWebhook(subscriptionEntity, paymentEntity) {
            try {
                const orgId = subscriptionEntity.notes?.org_id;
                const userId = subscriptionEntity.notes?.user_id;
                const pricingPlanId = subscriptionEntity.notes?.pricing_plan_id;
                const subscriptionId = subscriptionEntity.id;
                const paymentId = paymentEntity.id;
                const amount = paymentEntity.amount / 100; // Convert paise to currency
                const currency = paymentEntity.currency;
                const status = this.mapRazorpayStatus(paymentEntity.status);

                if (!orgId || !userId || !pricingPlanId) {
                    this.logger.error("Missing essential notes in subscription webhook:", subscriptionEntity.notes);
                    return;
                }

                // 1. Record the transaction
                const transactionData = paymentUtils.createTransactionObject({
                    type: "subscription",
                    amount,
                    description: `Subscription charge for plan ${pricingPlanId}`,
                    userId,
                    org_id: orgId,
                    payment_gateway: "razorpay",
                    gateway_transaction_id: paymentId,
                    gateway_order_id: paymentEntity.order_id,
                    gateway_subscription_id: subscriptionId,
                    merchant_order_id: paymentEntity.order_id, // Using order_id as merchant_order_id for subscriptions
                    currency,
                    status,
                    metadata: {
                        pricingPlanId: pricingPlanId,
                        razorpaySubscription: subscriptionEntity,
                        razorpayPayment: paymentEntity
                    }
                });

                await this.adapter.insert(transactionData);
                this.logger.info(`Subscription transaction recorded for org ${orgId}, plan ${pricingPlanId}`);

                // 2. Update the organization's plan details
                // Assuming 'ums_organisation' service has an action to update organization details
                await this.broker.call("ums_organisation.update", {
                    id: orgId,
                    data: {
                        current_plan: pricingPlanId, // Store the pricing plan ID
                        razorpay_subscription_id: subscriptionId, // Store Razorpay subscription ID
                        subscription_status: subscriptionEntity.status, // Store Razorpay subscription status
                        subscription_start_at: new Date(subscriptionEntity.start_at * 1000), // Convert Unix timestamp to Date
                        subscription_end_at: new Date(subscriptionEntity.end_at * 1000), // Convert Unix timestamp to Date
                        // Add other relevant subscription details to the organization model as needed
                    }
                });
                this.logger.info(`Organization ${orgId} plan updated to ${pricingPlanId}`);

                // Send notification for successful subscription charge
                try {
                    await this.broker.call("notification.send", {
                        templateKey: "subscription_charged_success",
                        variables: {
                            amount: amount,
                            currency: currency,
                            paymentGateway: "Razorpay",
                            pricingPlanId: pricingPlanId,
                            subscriptionId: subscriptionId
                        },
                        additionalData: {
                            organisation_id: orgId,
                            user_id: userId,
                            broadcast_type: "org"
                        }
                    });
                } catch (notifyErr) {
                    this.logger?.error?.("Failed to send subscription charged success notification:", notifyErr);
                }

            } catch (error) {
                this.logger.error("Error handling subscription.charged webhook:", error);
            }
        },

        /**
         * Handles the Razorpay subscription cancellation webhook event.
         *
         * This method processes the cancellation of a subscription by:
         *  - Extracting essential identifiers (organization ID, user ID, pricing plan ID) from the subscription entity's notes.
         *  - Validating the presence of required notes; logs an error and exits if any are missing.
         *  - Updating the organization's subscription status and end date in the user management service (UMS).
         *  - Optionally, a downgrade to a free/default plan can be performed (currently commented).
         *  - Logging the successful cancellation.
         *  - Sending a notification about the successful subscription cancellation to the organization.
         *  - Logging any errors encountered during notification sending.
         *  - Catching and logging any errors that occur during the overall process.
         *
         * @async
         * @param {Object} subscriptionEntity - The subscription entity received from the Razorpay webhook.
         * @param {Object} subscriptionEntity.notes - Additional metadata, expected to contain org_id, user_id, and pricing_plan_id.
         * @param {string} subscriptionEntity.notes.org_id - The organization ID associated with the subscription.
         * @param {string} subscriptionEntity.notes.user_id - The user ID who initiated the subscription.
         * @param {string} subscriptionEntity.notes.pricing_plan_id - The pricing plan ID of the subscription.
         * @param {string} subscriptionEntity.id - The unique identifier of the subscription.
         * @param {string} subscriptionEntity.status - The current status of the subscription (should be 'cancelled').
         * @param {number} [subscriptionEntity.ended_at] - The Unix timestamp (in seconds) when the subscription ended.
         * @returns {Promise<void>} Resolves when the cancellation handling is complete.
         */
        async handleSubscriptionCancelledWebhook(subscriptionEntity) {
            try {
                const orgId = subscriptionEntity.notes?.org_id;
                const userId = subscriptionEntity.notes?.user_id;
                const pricingPlanId = subscriptionEntity.notes?.pricing_plan_id;
                const subscriptionId = subscriptionEntity.id;
                const status = this.mapRazorpayStatus(subscriptionEntity.status); // Should be 'cancelled'

                if (!orgId || !userId || !pricingPlanId) {
                    this.logger.error("Missing essential notes in subscription cancellation webhook:", subscriptionEntity.notes);
                    return;
                }

                // Update the organization's plan details to reflect cancellation
                await this.broker.call("ums_organisation.update", {
                    id: orgId,
                    data: {
                        subscription_status: status, // Set to 'cancelled'
                        subscription_end_at: subscriptionEntity.ended_at ? new Date(subscriptionEntity.ended_at * 1000) : new Date(), // Set actual end date or current date
                        // Optionally, downgrade the plan to a free/default plan here
                        // current_plan: "free_plan_id",
                    }
                });
                this.logger.info(`Organization ${orgId} subscription ${subscriptionId} cancelled.`);

                // Send notification for successful subscription cancellation
                try {
                    await this.broker.call("notification.send", {
                        templateKey: "subscription_cancelled_success", // Define this template
                        variables: {
                            pricingPlanId: pricingPlanId,
                            subscriptionId: subscriptionId,
                            status: status
                        },
                        additionalData: {
                            organisation_id: orgId,
                            user_id: userId,
                            broadcast_type: "org"
                        }
                    });
                } catch (notifyErr) {
                    this.logger?.error?.("Failed to send subscription cancelled success notification:", notifyErr);
                }

            } catch (error) {
                this.logger.error("Error handling subscription.cancelled webhook:", error);
            }
        }
    },

    created() {
        // Service created lifecycle event
    },

    started() {
        // Service started lifecycle event
    },

    stopped() {
        // Service stopped lifecycle event
    }
};
