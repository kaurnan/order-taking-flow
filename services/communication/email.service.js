const nodemailer = require("nodemailer");

"use strict";

module.exports = {
    name: "email",
    settings: {
        smtp: {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        },
        from: process.env.SMTP_FROM,
        mailerCloud: {
            apiKey: process.env.MAILER_CLOUD_API_KEY,
            baseUrl: process.env.MAILERCLOUD_BASE_URL,
        },
    },

    actions: {
        send(ctx) {
            const { to, subject, text, html } = ctx.params;
            return this.transporter
                .sendMail({
                    from: this.settings.from,
                    to,
                    subject,
                    text,
                    html,
                })
                .then((info) => {
                    this.logger.info("Email sent: ", info.messageId);
                    return { messageId: info.messageId };
                })
                .catch((err) => {
                    this.logger.error("Error sending email: ", err);
                    throw new Error("Failed to send email");
                });
        },
    },

    created() {
        this.transporter = nodemailer.createTransport(this.settings.smtp);
    },
};