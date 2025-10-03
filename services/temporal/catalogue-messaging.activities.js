"use strict";

const axios = require("axios");

/**
 * Catalogue Messaging Activities (Temporal)
 * Export plain async functions; Temporal will bind them in the worker.
 * Activities should NOT rely on a Moleculer broker instance.
 */

async function sendCatalogueMessage(params) {
    const { to, catalogueData, message, channel_id, channel, orgId, branchId } = params;
    try {
        console.log(`Activity: Sending catalogue message to ${to}`);

        // Build the text body from provided catalogueData
        let body = `🛍️ ${message}\n\n📦 **Our Latest Products:**\n\n`;
        if (Array.isArray(catalogueData?.products) && catalogueData.products.length > 0) {
            for (let i = 0; i < catalogueData.products.length; i++) {
                const p = catalogueData.products[i];
                body += `${i + 1}. **${p.name || "Product"}**\n`;
                if (p.price) body += `   💰 Price: ${p.price}\n`;
                if (p.availability) body += `   📦 Status: ${p.availability}\n`;
                if (p.retailer_id) body += `   🏷️ SKU: ${p.retailer_id}\n`;
                body += "\n";
            }
            body += "💬 Reply with the product number to order!";
        } else {
            body += `📦 Browse our products: https://www.facebook.com/commerce/products/?catalog_id=${catalogueData?.catalogueId || ""}`;
        }

        // Call Moleculer API to send via WhatsApp (avoids needing broker in activities)
        const res = await axios.post(
            "http://localhost:3001/api/whatsapp/SendMsgViaBSP",
            {
                to,
                contact_id: 12345,
                message_type: "text",
                meta_payload: { body },
                channel_id,
                channel
            },
            {
                headers: { "Content-Type": "application/json" },
                // Pass org/branch via custom headers if needed by API gateway
            }
        );

        console.log(`Catalogue message activity completed: ${res.data?.data?.messages?.[0]?.id || "<no-id>"}`);
        return res.data;
    } catch (error) {
        console.error("Catalogue message activity failed:", error.response?.data || error.message);
        throw error;
    }
}

async function sendCatalogueTemplate(params) {
    const { to, templateName, templateLanguage, catalogueId, templateData, channel_id, channel } = params;
    try {
        console.log(`Activity: Sending catalogue template ${templateName} to ${to}`);
        const res = await axios.post(
            "http://localhost:3001/api/whatsapp/sendCatalogueTemplate",
            {
                to,
                templateName,
                templateLanguage,
                catalogueId,
                templateData,
                channel_id,
                channel
            },
            { headers: { "Content-Type": "application/json" } }
        );
        console.log(`Catalogue template activity completed: ${res.data?.messageId || "<no-id>"}`);
        return res.data;
    } catch (error) {
        console.error("Catalogue template activity failed:", error.response?.data || error.message);
        throw error;
    }
}

module.exports = { sendCatalogueMessage, sendCatalogueTemplate };
