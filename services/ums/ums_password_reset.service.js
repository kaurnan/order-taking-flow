"use strict";


const crypto = require("crypto");
const bcrypt = require("bcrypt");
const dbMixin = require("../../mixins/db.mixin");

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
    name: "ums_password_reset",
    mixins: [dbMixin("ums/password_reset")],

    /**
     * Settings
     */
    settings: {
    },


    /**
     * Methods
     */
    actions: {
        async createPasswordResetToken(ctx) {
            const { email } = ctx.params;
            const rawToken = crypto.randomBytes(32).toString("hex");
            console.log("Raw token generated:", rawToken);
            const tokenHash = await bcrypt.hash(rawToken, 10);

            const existingRecord = await this.adapter.findOne({ email });
            if (existingRecord) {
                await this.adapter.updateById(existingRecord._id, {
                    $set: { tokenHash, expiresAt: Date.now() + 60 * 60 * 1000 }
                });
                return { rawToken, record: existingRecord };
            } else {
                const record = await this.adapter.insert({
                    email, tokenHash, expiresAt: Date.now() + 60 * 60 * 1000
                });
                return { rawToken, record };
            }
        },

        async verifyToken(ctx) {
            const { email, token } = ctx.params;
            const record = await this.adapter.findOne({ email, used: false });
            if (!record) {
                return { success: false, message: "Token not found or already used." };
            }
            const isValid = await bcrypt.compare(token, record.tokenHash);
            if (!isValid) {
                return { success: false, message: "Invalid token." };
            }
            await this.adapter.model.findByIdAndDelete(record._id);
            return { success: true };
        },

        async markAsUsed(ctx) {
            const { email, token } = ctx.params;
            const record = await this.adapter.findOne({ email });
            if (!record) {
                return { success: false, message: "Token not found or already used." };
            }

            const isValid = await bcrypt.compare(token, record.tokenHash);
            if (!isValid) {
                return { success: false, message: "Invalid token." };
            }

            await this.adapter.updateById(record._id, { $set: { used: true } });
            return { success: true };
        }
    },

    /**
     * Fired after database connection establishing.
     */
    async afterConnected() {
        // await this.adapter.collection.createIndex({ name: 1 });
    }
};
