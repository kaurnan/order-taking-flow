const crypto = require("crypto");
const dbMixin = require("../../mixins/db.mixin");

module.exports = {
    name: "ums_verify",

    mixins: [dbMixin("ums/verification")], // Uses Moleculer-DB for database operations
    settings: {
        fields: ["_id", "email", "otp", "expiresAt"]
    },

    actions: {
        /**
         * ✅ Store OTP for Email Verification
         * Generates an OTP, stores it in the database, and returns it.
         * If `resend=true` is passed, a new OTP is generated and sent.
         */
        storeCode: {
            rest: {
                method: "POST",
                path: "/account"
            },
            params: {
                email: "string",
                phone_number: { type: "string", optional: true },
                resend: { type: "boolean", optional: true },
                type: { type: "string" }
            },
            rateLimit: {
                windowMs: 60 * 60 * 1000,  // 1 hour
                max: 5,
                headers: true,
                key: (req) => {
                    return req.headers["x-forwarded-for"] ||
                        req.connection.remoteAddress ||
                        req.socket.remoteAddress ||
                        req.connection.socket.remoteAddress;
                }
            },
            async handler(ctx) {
                try {
                    const { email, resend, type, phone_number } = ctx.params;
                    const checkEmailstatus = await ctx.call("ums_user.checkEmailAlreadyVerified", { email, type });
                    if (!checkEmailstatus.success) {
                        return { success: false, message: checkEmailstatus.message };
                    }
                    // Check if an OTP already exists for this email
                    const existingOtpRecord = await this.adapter.findOne({ email });

                    if (existingOtpRecord && !resend) {
                        console.log("Existing OTP record found:", existingOtpRecord.createdAt);

                        // Check if the existing OTP was created recently (within 5 minutes)
                        const timeElapsed = Date.now() - new Date(existingOtpRecord.createdAt).getTime();
                        if (timeElapsed < 5 * 60 * 1000) {
                            return {
                                success: false,
                                message: "An OTP has already been sent to this email. Please wait before requesting a new one."
                            };
                        }
                    }

                    // If resend=true and an existing OTP record exists, remove it
                    if (resend && existingOtpRecord) {
                        await this.adapter.model.findByIdAndDelete(existingOtpRecord._id);
                    }

                    // Generate a random 6-digit OTP
                    const otp = Math.floor(100000 + Math.random() * 900000).toString();

                    // Hash the OTP for security before storing
                    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

                    // Set OTP expiration time (e.g., 5 minutes from now)
                    const expiresAt = Date.now() + 5 * 60 * 1000;
                    console.log(hashedOtp);

                    // Save OTP to the database
                    await this.adapter.insert({ email, otp: hashedOtp, expiresAt, phone_number });
                    ctx.call("email.send", {
                        to: email,
                        subject: `${type == "reset_password" ? "Reset Password" : "Verify your account"}`,
                        text: `Your OTP for ${type == "reset_password" ? "reset password" : "account verification"} is: ${otp}`,
                        html: `<p>Your OTP for ${type == "reset_password" ? "reset password" : "account verification"} is: <strong>${otp}</strong></p>`
                    }).then(res => {
                        console.log("Email sent", res);
                    }).catch(err => {
                        console.error("Failed to send email", err);
                    });
                    if (phone_number) {
                        ctx.call("whatsapp.sendMessage", {
                            to: phone_number,
                            body: {
                                name: "otp_verification",
                                language: {
                                    code: "en"
                                },
                                components: [
                                    {
                                        type: "body",
                                        parameters: [
                                            {
                                                type: "text",
                                                text: otp
                                            }
                                        ]
                                    },
                                    {
                                        type: "button",
                                        sub_type: "url",
                                        index: "0",
                                        parameters: [
                                            {
                                                type: "text",
                                                text: otp
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

                    }

                    // TODO: Send OTP via email (Mocked for now)
                    this.logger.info(`OTP sent to ${email}: ${otp}`);

                    return { success: true, message: "OTP sent successfully." };
                } catch (error) {
                    console.error("Error in storeCode:", error);
                    return { success: false, message: "Failed to send OTP." };
                }
            }
        },


        verifyAccount: {
            rest: {
                method: "POST",
                path: "/otp",
            },
            params: {
                email: "string",
                otp: "string",
                type: "string"
            },
            async handler(ctx) {
                const { email, otp, type } = ctx.params;
                const checkEmailstatus = await ctx.call("ums_user.checkEmailAlreadyVerified", { email, type });
                if (!checkEmailstatus.success) {
                    return { success: false, message: checkEmailstatus.message };
                }

                // Hash the OTP before checking (to match stored hash)
                const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

                // Find OTP record
                const otpRecord = await this.adapter.findOne({ email });

                console.log(otpRecord, hashedOtp, email);
                if (!otpRecord) return { success: false, message: "Invalid or expired OTP." };

                // Check if the hashed OTP matches the stored OTP
                if (otpRecord.otp !== hashedOtp) {
                    return { success: false, message: "Invalid OTP." };
                }

                // Check if OTP is expired
                if (Date.now() > otpRecord.expiresAt) {
                    this.adapter.model.findByIdAndDelete(otpRecord._id).then(() => {
                        this.logger.info("OTP record deleted successfully.");
                    }).catch(err => {
                        this.logger.error("Error deleting OTP record:", err);
                    });
                    return { success: false, message: "OTP has expired." };
                }

                // Call another service method to confirm email verification and create password reset token in parallel
                const [confirmation, resetTokenRecord] = await Promise.all([
                    ctx.call("ums_user.confirmEmailVerification", { email, type }),
                    ctx.call("ums_password_reset.createPasswordResetToken", { email })
                ]);

                if (!confirmation.success) {
                    return { success: false, message: confirmation.message };
                }

                // Delete OTP record after successful verification (asynchronous)
                this.adapter.model.findByIdAndDelete(otpRecord._id).then(() => {
                    this.logger.info("OTP record deleted successfully.");
                }).catch(err => {
                    this.logger.error("Error deleting OTP record:", err);
                });

                return {
                    success: true,
                    message: "Email verified successfully.",
                    resetToken: resetTokenRecord.rawToken
                };
            }
        },
    },
};
