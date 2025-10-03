const axios = require("axios");
const jwt = require("jsonwebtoken");

module.exports = {
    name: "temporal.gateway",

    settings: {
        baseURL: process.env.TEMPORAL_GATEWAY_URL || "http://localhost:3003",
        // Use ONE of the following auth methods:
        // 1) Provide a static token (raw JWT string, WITHOUT the "Bearer " prefix)
        staticToken: process.env.TEMPORAL_GATEWAY_TOKEN || null,
        // 2) Or sign a short-lived token locally with the same secret your Express app uses:
        jwtSecret: process.env.JWT_SECRET || null,     // must match Express
        jwtPayload: { user: "moleculer-service" },
        jwtExpiresIn: "5m",

        timeoutMs: 60_000
    },

    created() {
        this.http = axios.create({
            baseURL: this.settings.baseURL,
            timeout: this.settings.timeoutMs
        });
    },

    actions: {
        /**
         * Starts your exampleShopify workflow via Express /start-workflow
         * Params: { name: string }
         */
        ExecuteShopifyWorkflow: {
            params: { 
                name: "string",
                orderData: "object",
                customerData: "object", 
                orgData: "object"
            },
            retryPolicy: { enabled: true, retries: 2, delay: 500, maxDelay: 2000, factor: 2 },
            async handler(ctx) {
                const token = this.getToken();
                const { name, orderData, customerData, orgData } = ctx.params;

                const { data } = await this.http.post(
                    "/exec-shopify",
                    { 
                        name,
                        orderData,
                        customerData,
                        orgData
                    },
                    { headers: { Authorization: `Bearer ${token}` } }
                );

                // Your Express handler waits for handle.result() and returns { workflowId, result }
                return data;
            }
        },

        /**
         * Execute catalogue messaging workflow
         */
        ExecuteCatalogueMessagingWorkflow: {
            params: { 
                customerData: "object",
                catalogueData: "object",
                orgData: "object",
                messageConfig: "object"
            },
            retryPolicy: { enabled: true, retries: 2, delay: 500, maxDelay: 2000, factor: 2 },
            async handler(ctx) {
                const token = this.getToken();
                const { customerData, catalogueData, orgData, messageConfig } = ctx.params;

                const { data } = await this.http.post(
                    "/exec-catalogue-messaging",
                    { 
                        customerData,
                        catalogueData,
                        orgData,
                        messageConfig
                    },
                    { headers: { Authorization: `Bearer ${token}` } }
                );

                return data;
            }
        },

        /**
         * Generic passthrough for future endpoints (e.g., /signal, /query).
         * Params: { path: string, method?: "GET"|"POST", body?: object }
         */
        callGateway: {
            params: {
                path: "string",
                method: { type: "enum", values: ["GET", "POST"], optional: true },
                body: { type: "object", optional: true }
            },
            async handler(ctx) {
                const token = this.getToken();
                const { path, method = "POST", body } = ctx.params;

                const { data } = await this.http.request({
                    url: path,
                    method,
                    data: method === "POST" ? (body || {}) : undefined,
                    headers: { Authorization: `Bearer ${token}` }
                });
                return data;
            }
        }
    },

    methods: {
        getToken() {
            // Prefer static token if you pasted one from the Express startup log.
            if (this.settings.staticToken) return this.settings.staticToken;
            if (!this.settings.jwtSecret) {
                throw new Error("Set either TEMPORAL_GATEWAY_TOKEN or JWT_SECRET for the gateway auth.");
            }
            return jwt.sign(this.settings.jwtPayload, this.settings.jwtSecret, {
                expiresIn: this.settings.jwtExpiresIn
            });
        }
    }
};
