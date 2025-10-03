"use strict";

const DbService = require("moleculer-db");
const MongooseAdapter = require("moleculer-db-adapter-mongoose");
const Redis = require("ioredis");
const dotenv = require("dotenv");
dotenv.config();

module.exports = function (modelName, opts = {}) {
    const redisUri = process.env.REDIS_URI;
    const CACHE_NS = process.env.CACHE_NS || process.env.NODE_ENV || "default";
    const RUN_INDEX_SYNC = process.env.RUN_INDEX_SYNC === "1";
    const cacheEnabled = opts.cache !== false;

    const redis = cacheEnabled ? new Redis(redisUri, { maxRetriesPerRequest: null }) : null;

    const cacheCleanEventName = `cache.clean.${modelName}`;
    const CACHE_PREFIX = `${CACHE_NS}:${modelName}:`;

    async function scanDel(client, pattern, chunk = 500) {
        if (!client) return 0;
        let cursor = "0";
        let total = 0;
        do {
            const res = await client.scan(cursor, "MATCH", pattern, "COUNT", chunk);
            cursor = res[0];
            const keys = res[1];
            if (keys.length) {
                const pipeline = client.pipeline();
                keys.forEach(k => pipeline.unlink(k));
                await pipeline.exec();
                total += keys.length;
            }
        } while (cursor !== "0");
        return total;
    }

    return {
        mixins: [DbService],
        adapter: new MongooseAdapter(process.env.MONGO_URI, {
            maxPoolSize: 5,
            minPoolSize: 0,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            appName: "flowflex-services"
        }),
        model: require(`../models/${modelName}.model`),

        actions: {
            cacheClear: {
                params: { pattern: { type: "string", optional: true } },
                async handler(ctx) {
                    if (!redis) return { success: false, message: "Cache disabled" };
                    const pattern = ctx.params.pattern || `${CACHE_PREFIX}*`;
                    const cleared = await scanDel(redis, pattern);
                    return { success: true, cleared };
                }
            }
        },

        events: cacheEnabled
            ? {
                async [cacheCleanEventName]() {
                    await scanDel(redis, `${CACHE_PREFIX}*`);
                }
            }
            : {},

        methods: {
            async entityChanged(type, json, ctx) {
                if (cacheEnabled) ctx.broadcast(cacheCleanEventName);
            },

            async getFromCacheOrDB(key, queryFn, ttl = 60) {
                if (!cacheEnabled) return queryFn();

                const cacheKey = `${CACHE_PREFIX}${key}`;
                const cached = await redis.get(cacheKey);
                if (cached) return JSON.parse(cached);

                const data = await queryFn();
                const ttlSec = Math.max(1, ttl | 0);
                // Cache empty arrays/objects too; skip only if data is undefined
                if (data !== undefined) {
                    await redis.set(cacheKey, JSON.stringify(data), "EX", ttlSec);
                }
                return data;
            },

            generateCacheKey(ctx, prefix = "", includeMeta = ["org_id", "branch_id"]) {
                const params = JSON.stringify(ctx?.params || {});
                const meta = JSON.stringify(
                    includeMeta.reduce((acc, key) => {
                        if (ctx?.meta?.[key] !== undefined) acc[key] = ctx.meta[key];
                        return acc;
                    }, {})
                );
                const base = `${params}:${meta}`;
                const encoded = Buffer.from(base).toString("base64url");
                return `${prefix}:${this.name}:${encoded}`;
            },

            async clearModelCache() {
                if (!redis) return 0;
                return scanDel(redis, `${CACHE_PREFIX}*`);
            },

            setupConnectionMonitoring() {
                const mongoose = this.adapter?.db?.connection;
                if (!mongoose) {
                    this.logger.warn(`Mongoose connection not available for ${modelName}`);
                    return;
                }
                mongoose.on("connected", () => this.logger.info(`MongoDB connected for ${modelName}`));
                mongoose.on("disconnected", () => this.logger.warn(`MongoDB disconnected for ${modelName}`));
                mongoose.on("reconnected", () => this.logger.info(`MongoDB reconnected for ${modelName}`));
                mongoose.on("error", (error) => this.logger.error(`MongoDB error for ${modelName}:`, error));
            }
        },

        async started() {
            this.setupConnectionMonitoring();

            if (this.seedDB) {
                const count = await this.adapter.count();
                if (count === 0) {
                    this.logger.info(`'${modelName}' collection empty. Seeding...`);
                    await this.seedDB();
                    this.logger.info(`Seeding done. Records: ${await this.adapter.count()}`);
                }
            }

            if (RUN_INDEX_SYNC && this.model?.syncIndexes) {
                await this.model.syncIndexes();
                this.logger.info(`Indexes synced for '${modelName}'`);
            }

            // Attach signal handlers once per service instance
            this._sigHandler = async (signal) => {
                try {
                    this.logger.info(`Received ${signal}. Closing connections for ${modelName}...`);
                    if (this.adapter?.db?.connection?.close) {
                        await this.adapter.db.connection.close(false);
                    }
                    if (redis) await redis.quit();
                } catch (e) {
                    // ignore
                } finally {
                    process.exit(0);
                }
            };
            process.on("SIGINT", this._sigHandler);
            process.on("SIGTERM", this._sigHandler);
        },

        async stopped() {
            try {
                if (this.adapter?.db?.connection?.close) {
                    await this.adapter.db.connection.close(false);
                }
            } catch (_) { }
            if (redis) {
                try { await redis.quit(); } catch (_) { }
            }
            if (this._sigHandler) {
                process.off("SIGINT", this._sigHandler);
                process.off("SIGTERM", this._sigHandler);
                this._sigHandler = null;
            }
        }
    };
};
