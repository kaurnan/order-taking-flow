// gateways/api.service.js

"use strict";



const ApiService = require("moleculer-web");

const _ = require("lodash");

const { UnAuthorizedError } = ApiService.Errors;

const jwt = require("jsonwebtoken");

const express = require('express');

const { createBullBoard } = require('@bull-board/api');

const { ExpressAdapter } = require('@bull-board/express');

const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');

const sendMessageQueue = require('../queues/send_message.queue');

const shopifyCustomerSyncQueue = require("../queues/shopifycustomer_sync.queue");

const walletBalanceQueue = require('../queues/wallet_balance.queue');

const broadcastBatchQueue = require('../queues/broadcast_batch.queue');

const templateDeleteQueue = require("../queues/template_delete.queue");

const invoiceQueue = require("../queues/invoice.queue");

const customerImportQueue = require("../queues/customer-import.queue");

const mergeListQueue = require("../queues/merge-list.queue");

const bulkCustomerUpdateQueue = require("../queues/bulk-customer-update.queue");

const profileExportQueue = require("../queues/profile-export.queue");

const customerExportQueue = require("../queues/customer-export.queue");

const dailyUsageQueue = require("../queues/daily_usage.queue");

const exchangeRateQueue = require("../queues/exchange_rate.queue");

const { PubSub } = require('@google-cloud/pubsub');



module.exports = {

    name: "api",

    mixins: [ApiService],

    settings: {

        port: process.env.PORT || 3001,

        // Exposed IP

        ip: "0.0.0.0",



        // Global Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares

        use: [],



        cors: {

            // Configures the Access-Control-Allow-Origin CORS header.

            origin: "*",

            // Configures the Access-Control-Allow-Methods CORS header. 

            methods: ["GET", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"],

            // Configures the Access-Control-Allow-Headers CORS header.

            allowedHeaders: ["Content-Type", "Authorization", "branch-id"],

            // Configures the Access-Control-Expose-Headers CORS header.

            exposedHeaders: [],

            // Configures the Access-Control-Allow-Credentials CORS header.

            credentials: false,

            // Configures the Access-Control-Max-Age CORS header.

            maxAge: 3600

        },



        routes: [

            {

                name: "api-type_1",

                path: "/api",

                whitelist: [

                    "**"

                ],



                // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares

                use: [

                    function (err, req, res, next) {

                        this.logger.error("Error is occured in middlewares!");

                        this.sendError(req, res, err);

                    }

                ],



                // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging

                mergeParams: true,



                // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication

                authentication: false,



                // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization

                authorization: true,



                // The auto-alias feature allows you to declare your route alias directly in your services.

                // The gateway will dynamically build the full routes from service schema.

                autoAliases: false,



                aliases: {

                    // Expose UMS endpoints via the gateway. Adjust naming to match your service version/names.

                    "POST /organisation": "ums_organisation.create",

                    "PUT /organisation/profile-image": "ums_organisation.updateProfileImage",

                    "GET /config": "ums_app.getByOrigin",

                    "GET /scopes": "ums_scopes.listScopes",

                    "GET /switch-org": "ums_organisation.switchOrganisation",

                    "GET /user-organisations": "ums_user_organisations.listOrganisations",

                    "GET /user": "ums_user.getUser",



                    /**

                     * Flowstore Creator endpoints

                     */

                    "GET /creator-automations": "flowstorecreator.MyAutomations",

                    "POST /upload-file-creator": "multipart:gcp.upload",

                    "POST /update-automation": "flowstorelist.UpdateFlow",



                    /**

                     * API Documentation endpoints

                     */

                    // "GET /docs": "api-docs.getDocs",

                    // "GET /docs/spec": "api-docs.getSpec",

                    // "GET /docs/service/:serviceName": "api-docs.getServiceDocs",

                    // "GET /docs/html": "api-docs.getHtmlDocs"

                },



                /**

                 * Before call hook. You can check the request.

                 * @param {Context} ctx

                 * @param {Object} route

                 * @param {IncomingRequest} req

                 * @param {ServerResponse} res

                 * @param {Object} data

                 **/



                onBeforeCall(ctx, route, req, res) {

                    ctx.meta.origin = req.headers.origin;

                    // Bypass authorization for this specific endpoint

                    if (req.$endpoint.action.name === "api.nodeServices") {

                        ctx.meta.user = { role: "public" }; // Mock user role

                    }

                },



                /**

                 * After call hook. You can modify the data.

                 * @param {Context} ctx

                 * @param {Object} route

                 * @param {IncomingRequest} req

                 * @param {ServerResponse} res

                 * @param {Object} data

                onAfterCall(ctx, route, req, res, data) {

                    // Async function which return with Promise

                    return doSomething(ctx, res, data);

                }, */



                // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options

                callOptions: {},



                bodyParsers: {

                    json: {

                        strict: false,

                        limit: "1MB"

                    },

                    urlencoded: {

                        extended: true,

                        limit: "1MB"

                    }

                },



                // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy

                mappingPolicy: "all", // Available values: "all", "restrict"



                // Enable/disable logging

                logging: true

            },

            {

                name: "api-redirect",

                path: "/",

                whitelist: [

                    "**"

                ],

                authentication: false,

                authorization: false,

                aliases: {

                    "GET /r/:shortCode": "redirectlink.redirect",

                },

                mappingPolicy: "all",

                logging: true

            },

            {

                name: "api-rateLimit-5ph",

                path: "/api",

                whitelist: [

                    "**"

                ],

                // this rateLimit overrides the global one (per-hour window, max 5)

                rateLimit: {

                    window: 60 * 60 * 1000,

                    limit: 100

                },

                aliases: {

                    // only this alias lives here:

                    "POST /verify-account": "ums_verify.storeCode"

                },

                // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy

                mappingPolicy: "all", // Available values: "all", "restrict"

            },

            {

                name: "api-gcp",

                path: "/api",

                whitelist: [

                    "**"

                ],

                // this rateLimit overrides the global one (per-hour window, max 5)

                rateLimit: {

                    window: 60 * 60 * 1000,

                    limit: 100

                },

                aliases: {

                    // only this alias lives here:

                    "POST /sendMsg": "whatsapp.SendMsgViaBSP"

                },

                // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy

                mappingPolicy: "all", // Available values: "all", "restrict"



                onBeforeCall(ctx, route, req, res) {

                    const workflowSecret = req.headers["x-auth-token"];

                    const expectedSecret = process.env.GCP_WORKFLOW_AUTH_SECRETKEY;



                    if (workflowSecret !== expectedSecret) {

                        throw new UnAuthorizedError();

                    }



                    ctx.meta.gcp = true;

                },

            },

            {

                name: "api-type_2",

                path: "/api",



                whitelist: [

                    "**"

                ],



                // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares

                use: [

                    function (err, req, res, next) {

                        this.logger.error("Error is occured in middlewares!");

                        this.sendError(req, res, err);

                    }

                ],



                // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging

                mergeParams: true,



                // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication

                authentication: false,



                // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization

                authorization: true,



                // The auto-alias feature allows you to declare your route alias directly in your services.

                // The gateway will dynamically build the full routes from service schema.

                autoAliases: false,



                aliases: {

                    // Expose UMS endpoints via the gateway. Adjust naming to match your service version/names.

                    "POST /user": "ums_user.create",

                    "PATCH /user": "ums_user.update",

                    "GET /users": "ums_user.listUsers",

                    "GET /users-by-org": "ums_user_organisations.listUsersByOrg",

                    "POST /archive-user": "ums_user.archiveUser",

                    "POST /unarchive-user": "ums_user.unarchiveUser",

                    "POST /invite-user": "ums_user_organisations.inviteUser",

                    "GET /accept-invite": "ums_user_organisations.acceptInvite",

                    "POST /login": "ums_user.authenticate",

                    "POST /logout": "ums_user.logout",

                    "POST /verify-otp": "ums_verify.verifyAccount",

                    "POST /set-password": "ums_user.setPassword",

                    "POST /change-password": "ums_user.changePassword",

                    "POST /forgot-password": "ums_user.forgotPassword",

                    "POST /social-login": "ums_user.socialLogin",

                    "POST /social-signup": "ums_user.socialSignup",

                    "POST /role": "ums_roles.create",

                    "PUT /role": "ums_roles.updateRole",

                    "DELETE /role": "ums_roles.deleteRole",

                    "GET /organisation": "ums_user_organisations.get",

                    "GET /roles": "ums_roles.listRoles",

                    "GET /generate-access-token": "ums_user.generateAccessToken",

                    "POST /create-role": "ums_roles.createRole",

                    "POST /interakt-events": "interakt.handleinterktEvents",

                    "GET /interakt-events": "interakt.challengeinterktEvents",

                    "POST /wa-sendmsg": "whatsapp.sendMessage",

                    "POST /wa-webhook": "whatsapp.handleWebhook",

                    "GET /wa-webhook": "whatsapp.verifyWebhook",

                    "POST /embeded_signup": "interakt.embededSignup",



                    "DELETE /delete-team-member": "ums_user_organisations.deleteTeamMember",

                    "POST /change-team-member-status": "ums_user_organisations.changeTeamMemberStatus",



                    "PUT /update-org-profile": "ums_organisation.updateProfileImage",



                    /**

                     * Redirect Link endpoints

                     */

                    "POST /redirect-link/generate": "redirectlink.generate",

                    "GET /redirect-link/:shortCode": "redirectlink.get",



                    /**

                     * Chat endpoints

                     */

                    "POST /SendMsgViaBSP": "whatsapp.SendMsgViaBSP",

                    "POST /mark-as-read": "whatsapp.MarkasRead",

                    "POST /create-media-id": "multipart:whatsapp.CreateMediaID",



                    /**

                     * Audience endpoints

                    */

                    "POST /audience": "customer.addAudience",

                    "GET /audience": "customer.getAudience",

                    "PUT /audience": "customer.updateAudience",

                    "DELETE /audience": "customer.deleteAudience",

                    "POST /add-audience-to-list": "customer.addAudienceToList",

                    "POST /remove-audience-from-list": "customer.removeFromList",

                    "GET /audience/overview": "customer.audienceOverview",

                    "GET /single-audience": "customer.getSingleAudience",

                    "POST /audience-list": "list.createList",

                    "GET /audience-list": "list.getList",

                    "GET /audience-listById": "list.getListById",

                    "POST /audience-bulk-update": "customer.bulkCustomerUpdate",

                    "PUT /audience-list": "list.updateList",

                    "DELETE /audience-list": "list.deleteList",

                    "POST /list-export": "list.exportListCustomers",

                    "POST /merge-list": "list.mergeList",

                    "POST /bulk-update-list": "list.bulkUpdateList",

                    "GET /dynamic-fields": "dynamicfield.getDynamicFields",

                    "GET /audience-belongs-to-segment": "customer.getCustomerSegments",

                    "GET /audience-column-order": "customer.getCustomerColumnOrder",

                    "POST /audience-column-order": "customer.saveCustomerColumnOrder",

                    "POST /profile-export": "customer.exportProfileById",

                    // Segment endpoints

                    "GET /audience-segments": "segment.getSegments",

                    "GET /audience-segment": "segment.getSegmentById",

                    "POST /audience-segment": "segment.createSegment",

                    "PUT /audience-segment": "segment.updateSegment",

                    "DELETE /audience-segment": "segment.deleteSegment",

                    "POST /manage-whatsapp-consent": "segment.manageSegmentWhatsAppConsent",

                    "POST /convert-to-list": "segment.convertSegmentToList",

                    "POST /bulk-update-segment": "segment.bulkUpdateSegment",

                    // Customer export endpoints

                    "GET /customer-export-history": "customerexport.listExports",

                    "DELETE /customer-export-history/:id": "customerexport.deleteExport",

                    "DELETE /bulk-delete-export-history": "customerexport.bulkDeleteExports",

                    // Customer import endpoints

                    "POST /audience-import": "customer.importCustomers",

                    "GET /audience-import-history": "customer.ImportHistories",

                    "DELETE /audience-import-history/:id": "customer.deleteImportHistory",

                    "GET /audience-import-status/:id": "customer.getImportHistoryById",

                    "DELETE /bulk-delete-import-history": "customer.bulkDeleteImportHistory",

                    /**

                     * Branch endpoints

                     */

                    "GET /branches": "branch.listBranchesByOrgId",

                    "POST /branches": "branch.create",

                    "PUT /branches/:id": "branch.update",

                    "DELETE /branches": "branch.delete",

                    /**

                     * Tag endpoints

                     */

                    "POST /tag": "tag.createTag",

                    "GET /tag": "tag.getTag",

                    /**

                     * Config endpoints

                     */

                    "GET /user-config": "ums_organisation.getUserConfig",

                    /**

                    * Database Health endpoints

                    */

                    "GET /db-health": "db-health.getHealthStatus",

                    "POST /db-reconnect": "db-health.forceReconnect",

                    /**

                     * Flow store endpoints

                     */

                    "GET /trending-flows": "flowstorelist.TrendingFlows",

                    "GET /flows-by-platform": "flowstorelist.FlowsByPlatform",

                    "GET /flowdetails": "flowstorelist.GetFlowDetails",

                    "GET /flow-categories": "flowstore_category.list",

                    "GET /flowpurchase": "flowstorelistcheckout.purchaseFlow",

                    "GET /flow-by-listing-id": "flowstorelistcheckout.GetFlowByListingId",

                    "POST /install-flow": "reactflow.installFlow",

                    "GET /flowstore-templates": "flowstore_template.listTemplates",

                    "POST /creator-flows": "flowstorelist.list",

                    "GET /creator-details": "flowstorecreator.GetCreator",



                    /**

                     * Create Channel

                     */

                    "POST /create-channel": "channel.createChannel",

                    "POST /getstarted-init": "getstarted.InitializeGetStarted",

                    "GET /getstarted-progress": "getstarted.getGetStartedProgress",

                    "GET /channels": "channel.getChannels",

                    "GET /channel": "channel.getChannel",

                    "POST /channel": "channel.updateChannel",

                    "POST /upload-file": "multipart:gcp.upload",

                    /**

                     * Conversation endpoints

                     */

                    "GET /list-folders": "custom_folders.GetCustomFolders",

                    "POST /create-folder": "custom_folders.CreateCustomFolder",

                    "PUT /update-folder": "custom_folders.UpdateCustomFolder",

                    "DELETE /folder": "custom_folders.DeleteCustomFolder",

                    "GET /business-hours": "whatsapp.getBusinessHours",

                    "PUT /business-hours": "whatsapp.updateBusinessHours",



                    /**

                     * Whatsapp Template endpoints

                     */

                    "GET /whatsapp-templates": "whatsapp.listTemplates",

                    "DELETE /whatsapp-template/:id": "whatsapp.deleteTemplate",

                    "DELETE /whatsapp-templates/bulk": "whatsapp.deleteMultipleTemplates",

                    "POST /whatsapp-template": "whatsapp.createTemplate",

                    "GET /whatsapp-template/:id": "whatsapp.getTemplateById",

                    "GET /bulk-delete-status/:jobId": "whatsapp.getBulkDeleteStatus",



                    /**

                     * Flow endpoints

                     */

                    "POST /flow": "flow.create",

                    "PUT /flow": "flow.updateFlow",

                    "GET /flow": "flow.getFlowById",

                    "GET /flows": "flow.listFlows",

                    "DELETE /flow": "flow.deleteFlow",

                    "GET /triggers": "trigger.listTriggers",



                    /**

                     * Default Flow endpoints

                     */

                    "GET /default-flow": "default_flows.getDefaultFlow",



                    /**

                     * Subflow endpoints

                     */

                    "POST /subflow": "subflow.create",

                    "PUT /subflow": "subflow.update",

                    "GET /subflows": "subflow.listSubflowsByFlowId",

                    "POST /publish-subflow": "subflow.publishSubflow",

                    "DELETE /subflow": "subflow.delete",



                    /**

                     * Campaign endpoints

                     */

                    "POST /campaign": "campaign.createUpdate",

                    "POST /publish-campaign": "campaign.publishCampaign",

                    "GET /campaigns": "campaign.listCampaigns",

                    "DELETE /campaign": "campaign.delete",

                    "POST /campaign-version-update": "campaign.updateToLatestVersion",

                    "PUT /change-campaign-status": "campaign.ChangeCampaignStatus",

                    "PUT /change-flow-status": "campaign.changeCampFlowStatus",



                    /*

                    * Flow Trigger endpoints

                    */

                    "GET /flow-trigger": "flow_triggers.findByTypeandTitle",



                    /**

                     * Broadcast endpoints

                     */

                    "GET /broadcast": "broadcast.listBroadcasts",

                    "POST /broadcast": "broadcast.createBroadcast",

                    "POST /process-broadcast": "broadcast.processBroadcast",

                    "POST /publish-broadcast": "broadcast.publishBroadcast",

                    "GET /broadcast/:id": "broadcast.findById",

                    "DELETE /broadcast/:id": "broadcast.deleteById",

                    "POST /broadcast/add": "broadcast.addJob",

                    "POST /broadcast/pause-resume": "broadcast.pauseResumeBroadcast",

                    "GET /broadcast-overview": "broadcast_overview.getOverview",



                    /*

                    * Outcome Table endpoints

                    */

                    "GET /flow-data-tables": "flowdata.flowDataTables",

                    "GET /flow-datas": "flowdata.flowData",

                    "GET /pinned-flow-data-tables": "flowdata.pinnedDataTables",

                    "POST /flow-data-table": "flowdata.createFlowDataTable",

                    "POST /save-flow-data": "flowdata.saveFlowData",

                    "POST /pin-flow-data-table": "flowdata.pinDataTable",

                    "DELETE /flow-data-table": "flowdata.deleteDataTable",



                    /*

                     * shopify endpoints

                     */

                    "POST /shopify-data-process": "shopify.ProcessShopifyEvents",



                    /**

                     * Timeline endpoints

                     */

                    "GET /timelines": "timeline.listTimelines",



                    /**

                     * Integration endpoints

                     */

                    "POST /integrations/shopify": "integrations.saveShopifyIntegration",

                    "POST /integrations/shopify/sync-customers": "shopify.syncShopifyCustomers",

                    "GET /integration": "integrations.getSpecificIntegration",



                    /**
                     * Order Processing endpoints
                     */
                    "POST /process-order": "order-processor.processNewOrder",
                    "GET /order-status/:orderId": "order-processor.getOrderStatus",
                    "POST /retry-order/:orderId": "order-processor.retryOrderProcessing",

                    /**
                     * Order Confirmation Template endpoints
                     */
                    "POST /order-confirmation-template": "order-confirmation-template.createOrderConfirmationTemplate",
                    "GET /order-confirmation-template/:id": "order-confirmation-template.getOrderConfirmationTemplate",
                    "PUT /order-confirmation-template/:id/status": "order-confirmation-template.updateTemplateStatus",
                    
                    /**

                     * Email endpoints

                     */

                    "POST /send-email": "email.send",



                    /**

                     * Billing endpoints

                     */

                    "GET /transactions": "transaction.getOrgTransactions",

                    "GET /pricing": "pricing.listPricingPlans",

                    "GET /pricing-list": "pricing.listPricings",

                    "GET /wallet-details": "wallet.getWalletByOrgId",

                    "POST /razorpay-wallet-recharge": "wallet.initiateRazorpayRecharge",

                    "PUT /wallet-threshold": "wallet.updateWalletThreshold",



                    /**

                     * Daily Usage Analytics endpoints

                     */

                    "GET /daily-usage": "daily_usage.getDailyUsageByMonth",

                    "GET /daily-usage/summary": "daily_usage.getDailyUsageSummary",

                    "GET /monthly-usage-history": "daily_usage.getMonthlyUsageHistory",



                    /**

                     * Invoice endpoints

                     */

                    "GET /invoices": "invoice.listInvoices",

                    "POST /invoices/download/all": "invoice.downloadAllInvoices",



                    "POST /phonepe-order": "phonepe.createSDKOrderRequest",

                    "POST /phonepe-payment-init": "phonepe.initiatePayment",

                    "POST /wallet-recharge": "wallet.rechargeWallet",

                    "POST /broadcast-stats/update": "broadcast_stats.updateBroadcastStats",

                    "GET /broadcast-stats/:broadcast_id": "broadcast_stats.getBroadcastStats",

                    "POST /broadcast-stats/bulk-update": "broadcast_stats.bulkUpdateBroadcastStats",

                    "POST /broadcast-stats/reset/:broadcast_id": "broadcast_stats.resetBroadcastStats",

                    // Razorpay webhook with custom handling for raw body

                    "POST /razorpay-webhook": {

                        action: "razorpay.handleWebhook",

                        middleware: [

                            (req, res, next) => {

                                // Capture raw body before any parsing

                                let data = '';

                                req.on('data', chunk => {

                                    data += chunk;

                                });

                                req.on('end', () => {

                                    req.rawBody = data;

                                    // Parse JSON for the service to use

                                    try {

                                        req.body = JSON.parse(data);

                                    } catch (error) {

                                        console.error("Failed to parse JSON from raw body:", error);

                                        req.body = {};

                                    }

                                    next();

                                });

                            }

                        ]

                    },

                    "POST /razorpay/subscription": "razorpay.createSubscription"

                },



                /**

                 * Before call hook. You can check the request.

                 * @param {Context} ctx

                 * @param {Object} route

                 * @param {IncomingRequest} req

                 * @param {ServerResponse} res

                 * @param {Object} data

                 **/



                onBeforeCall(ctx, route, req, res) {

                    ctx.meta.origin = req.headers.origin;

                    // Handle Razorpay webhook signature and raw body

                    const razorpaySignature = req.headers["x-razorpay-signature"];

                    if (razorpaySignature) {

                        ctx.meta.razorpaySignature = razorpaySignature;

                        // Store raw body for signature verification

                        if (req.body) {

                            ctx.meta.rawBody = req.body;

                        } else {

                            console.log("No raw body found in request");

                        }

                    } else {

                        console.log("No Razorpay signature found in headers");

                        console.log("Available headers:", Object.keys(req.headers));

                    }



                    // Bypass authorization for this specific endpoint

                    if (req.$endpoint.action.name === "api.nodeServices") {

                        ctx.meta.user = { role: "public" }; // Mock user role

                    }

                },



                /**

                 * After call hook. You can modify the data.

                 * @param {Context} ctx

                 * @param {Object} route

                 * @param {IncomingRequest} req

                 * @param {ServerResponse} res

                 * @param {Object} data

                onAfterCall(ctx, route, req, res, data) {

                    // Async function which return with Promise

                    return doSomething(ctx, res, data);

                }, */



                // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options

                callOptions: {},



                bodyParsers: {

                    json: {

                        strict: false,

                        limit: "1MB"

                    },

                    urlencoded: {

                        extended: true,

                        limit: "1MB"

                    },

                    // multipart: true

                },



                // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy

                mappingPolicy: "all", // Available values: "all", "restrict"



                // Enable/disable logging

                logging: true

            }

        ],



        rateLimit: {

            // How long to keep record of requests in memory (in milliseconds). 

            // Defaults to 60000 (1 min)

            window: 60 * 1000,



            // Max number of requests during window. Defaults to 30

            limit: 30,



            // Set rate limit headers to response. Defaults to false

            headers: true,



            // Function used to generate keys. Defaults to: 

            key: (req) => {

                return req.headers["x-forwarded-for"] ||

                    req.connection.remoteAddress ||

                    req.socket.remoteAddress ||

                    req.connection.socket.remoteAddress;

            },

            //StoreFactory: CustomStore

        },



        // Do not log client side errors (does not log an error response when the error.code is 400<=X<500)

        log4XXResponses: false,

        // Logging the request parameters. Set to any log level to enable it. E.g. "info"

        logRequestParams: null,

        // Logging the response data. Set to any log level to enable it. E.g. "info"

        logResponseData: null,





        // Serve assets from "public" folder. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Serve-static-files

        assets: {

            folder: "public",



            // Options to `server-static` module

            options: {}

        },



        onError(req, res, err) {

            // Return with the error as JSON object

            res.setHeader("Content-type", "application/json; charset=utf-8");

            // Ensure we have a valid HTTP status code

            let statusCode = 500;

            if (err && err.code) {

                // Validate that err.code is a valid HTTP status code

                const code = parseInt(err.code);

                if (code >= 100 && code < 600) {

                    statusCode = code;

                }

            }



            res.writeHead(statusCode);



            const errObj = {

                success: false,

                message: err.message || "An error occurred",

                code: statusCode || 500,

                data: err.data || null

            };

            res.end(JSON.stringify(errObj, null, 2));



            this.logResponse(req, res, err ? err.ctx : null);

        }

    },

    methods: {

        /**

          * Authorize the request. Check that the authenticated user has right to access the resource.

          *

          * PLEASE NOTE, IT'S JUST AN EXAMPLE IMPLEMENTATION. DO NOT USE IN PRODUCTION!

          *

          * @param {Context} ctx

          * @param {Object} route

          * @param {IncomingRequest} req

          * @returns {Promise}

          */

        /**

         * Authorize the request

         *

         * @param {Context} ctx

         * @param {Object} route

         * @param {IncomingRequest} req

         * @returns {Promise}

         */

        async authorize(ctx, route, req) {

            let token;

            if (req.headers.authorization) {

                let type = req.headers.authorization.split(" ")[0];

                if (type === "Token" || type === "Bearer")

                    token = req.headers.authorization.split(" ")[1];

            }



            if (req.headers["branch-id"]) {

                ctx.meta.branch_id = req.headers["branch-id"];

            }



            let user;

            if (token) {

                // Verify JWT token

                try {

                    const isBlacklisted = await this.broker.call("ums_user.isTokenBlacklisted", { token });

                    if (isBlacklisted) {

                        throw new UnAuthorizedError("Token is blacklisted");

                    }

                    user = await new Promise((resolve) => {

                        const environment = process.env;



                        jwt.verify(token, environment.JWT_SECRET || "unknown", (err, decoded) => {

                            let org_id = "";

                            let branch_id = ctx.meta["branch-id"] || "";

                            let user_id = "";

                            let ttl = 1;

                            let scopes = [];



                            if (err) {

                                console.error(err);

                                throw new UnAuthorizedError();

                            }

                            if (decoded) {

                                const newToken = jwt.sign(

                                    { org_id: decoded?.org_id, user: decoded?._id, ttl: decoded?.ttl },

                                    environment.JWT_SECRET || "",

                                    { expiresIn: "1d" }

                                );

                                ctx.meta["Authorization"] = newToken;

                                org_id = decoded?.org_id;

                                user_id = decoded?._id;

                                ttl = decoded?.ttl;

                                scopes = decoded?.scopes;

                            }



                            resolve({ org_id, branch_id, _id: user_id, ttl, scopes });

                        });

                    });



                    if (user) {

                        ctx.meta.user = _.pick(user, ["_id", "username", "email", "role", "organisation_id",]);

                        ctx.meta.token = token;

                        ctx.meta._id = user._id;

                        ctx.meta.org_id = user.org_id;

                        ctx.meta.app_id = user.app_id;

                        ctx.meta.scopes = user.scopes;

                        ctx.meta.ttl = user.ttl;

                        if (route.name == "api-type_2" && !user.org_id) {

                            throw new UnAuthorizedError();

                        }

                    }

                    else {

                        throw new UnAuthorizedError();

                    }

                } catch (err) {

                    console.log(err);

                    throw new UnAuthorizedError();

                }

            }



            if (req.$action.auth == "required" && !user)

                throw new UnAuthorizedError();

        },





    },



    started() {

        const bullApp = express();

        const serverAdapter = new ExpressAdapter();

        serverAdapter.setBasePath('/admin/queues');



        createBullBoard({

            queues: [

                new BullMQAdapter(sendMessageQueue),

                new BullMQAdapter(shopifyCustomerSyncQueue),

                new BullMQAdapter(walletBalanceQueue),

                new BullMQAdapter(broadcastBatchQueue),

                new BullMQAdapter(templateDeleteQueue),

                new BullMQAdapter(invoiceQueue),

                new BullMQAdapter(customerImportQueue),

                new BullMQAdapter(mergeListQueue),

                new BullMQAdapter(bulkCustomerUpdateQueue),

                new BullMQAdapter(profileExportQueue),

                new BullMQAdapter(customerExportQueue),

                new BullMQAdapter(dailyUsageQueue),

                new BullMQAdapter(exchangeRateQueue),

            ],

            serverAdapter,

            options: {

                uiConfig: {

                    boardTitle: 'FlowFlex',

                    enableSearch: true,

                    enableGlobalFilter: true,

                    boardLogo: {

                        path: 'https://aapkkzytqbykrkruxlip.supabase.co/storage/v1/object/public/flowflex//Group%203042931%20(2).png',

                        alt: 'FlowFlex Logo',

                        width: 50,

                        height: 50

                    },

                    favIcon: {

                        default: 'https://aapkkzytqbykrkruxlip.supabase.co/storage/v1/object/public/flowflex//Group%203042931%20(2).png',

                    }

                }

            }

        });



        bullApp.use('/admin/queues', serverAdapter.getRouter());



        bullApp.listen(3100, () => {

            this.logger.info('Bull Board running at http://localhost:3100/admin/queues');

        });

    }

};





