# Meta Catalogue Integration with WhatsApp

This document explains how to integrate Meta's Commerce Manager catalogue with WhatsApp Business API to send product catalogues and process orders.

## Overview

The Meta Catalogue Integration allows you to:
1. **Sync Shopify products** to Meta Commerce Manager
2. **Send interactive catalogue messages** via WhatsApp
3. **Process orders** placed through WhatsApp catalogue
4. **Handle webhooks** for order confirmations and interactions

## Architecture

```
Shopify Store → Meta Commerce Manager → WhatsApp Business API → Your Application
     ↓                    ↓                        ↓                    ↓
Products Sync → Catalogue Created → Catalogue Messages → Order Processing
```

## Setup Requirements

### 1. Meta Business Account Setup
- Create a Meta Business Account
- Set up WhatsApp Business API
- Create a catalogue in Commerce Manager
- Connect Shopify as a partner platform

### 2. Environment Variables
Add these to your `.env` file:
```env
# Meta API Configuration
META_ACCESS_TOKEN=your_meta_access_token
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret

# WhatsApp Configuration
WA_PHONE_NUMBER_ID=your_phone_number_id
WA_BUSINESS_ACCOUNT_ID=your_business_account_id

# BSP Configuration (Interakt/Gupshup)
INTERAKT_API=your_interakt_api_url
INTERAKT_TOKEN=your_interakt_token
GUPSHUP_PARTNER_API=your_gupshup_api_url
```

### 3. Database Models
The integration uses these collections:
- `catalogue_messages` - Logs of sent catalogue messages
- `orders` - Order records from catalogue purchases
- `channels` - WhatsApp channel configurations

## Services Overview

### 1. Meta Catalogue Service (`meta-catalogue.service.js`)
Handles communication with Meta's Graph API for catalogue operations.

**Key Actions:**
- `getCatalogueProducts` - Fetch products from catalogue
- `getCatalogueProduct` - Get specific product by retailer ID
- `getCatalogueInfo` - Get catalogue information
- `syncShopifyToCatalogue` - Sync Shopify products to Meta catalogue

### 2. WhatsApp Service (`whatsapp.service.js`)
Enhanced with catalogue messaging capabilities.

**New Actions:**
- `sendCatalogueMessage` - Send interactive catalogue message
- `sendCatalogueTemplate` - Send catalogue template message
- `handleCatalogueOrder` - Process orders from catalogue
- `handleCatalogueInteraction` - Track catalogue interactions

### 3. Catalogue Messaging Service (`catalogue-messaging.service.js`)
Orchestrates catalogue messaging workflows.

**Key Actions:**
- `sendCatalogueMessage` - Send catalogue message to customer
- `sendBulkCatalogueMessage` - Send to multiple customers
- `getCatalogueMessageHistory` - Get message history

### 4. Order Processor Service (`order-processor.service.js`)
Enhanced to handle catalogue orders.

**New Actions:**
- `processCatalogueOrder` - Process orders from WhatsApp catalogue

## Usage Examples

### 1. Send Interactive Catalogue Message

```javascript
// Send interactive catalogue message
const result = await broker.call("catalogue-messaging.sendCatalogueMessage", {
    customerId: "customer-123",
    catalogueId: "587001577223671",
    messageType: "interactive",
    message: "Check out our latest products! 🛍️",
    thumbnailProductId: "thhyde0x10"
}, {
    meta: {
        org_id: "org-123",
        branch_id: "branch-456"
    }
});
```

### 2. Send Catalogue Template Message

```javascript
// Send catalogue template message
const result = await broker.call("catalogue-messaging.sendCatalogueMessage", {
    customerId: "customer-123",
    catalogueId: "587001577223671",
    messageType: "template",
    templateName: "catalogue_template",
    templateLanguage: "en",
    templateData: {
        body_parameters: [
            { type: "text", text: "Customer Name" }
        ]
    }
}, {
    meta: {
        org_id: "org-123",
        branch_id: "branch-456"
    }
});
```

### 3. Bulk Catalogue Messaging

```javascript
// Send to multiple customers
const result = await broker.call("catalogue-messaging.sendBulkCatalogueMessage", {
    customerIds: ["customer-1", "customer-2", "customer-3"],
    catalogueId: "587001577223671",
    messageType: "interactive",
    message: "Special offer! Check out our products! 🎉"
}, {
    meta: {
        org_id: "org-123",
        branch_id: "branch-456"
    }
});
```

### 4. Fetch Catalogue Products

```javascript
// Get products from catalogue
const products = await broker.call("meta-catalogue.getCatalogueProducts", {
    catalogueId: "587001577223671",
    accessToken: "your_meta_access_token",
    limit: 10
});
```

## Webhook Handling

### WhatsApp Webhook Events

The system handles these webhook events:

1. **Catalogue Order** (`message.type === "order"`)
   - Triggered when customer places order through catalogue
   - Automatically processed through order processor

2. **Catalogue Interaction** (`message.type === "interactive"`)
   - Triggered when customer views catalogue
   - Logged for analytics

### Webhook Configuration

Add this to your webhook endpoint:

```javascript
// Handle catalogue order
if (message.type === "order") {
    this.handleCatalogueOrder(ctx, message, contact, channel, formatPhone);
}

// Handle catalogue interaction
if (message.type === "interactive" && message.interactive?.type === "catalog_message") {
    this.handleCatalogueInteraction(ctx, message, contact, channel, formatPhone);
}
```

## Temporal Workflows

### Catalogue Messaging Workflow

The system uses Temporal for reliable message delivery:

```javascript
// Start catalogue messaging workflow
const workflowResult = await broker.call("temporal-gateway.ExecuteCatalogueMessagingWorkflow", {
    customerData: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone
    },
    catalogueData: {
        catalogueId: "587001577223671"
    },
    orgData: {
        orgId: "org-123",
        branchId: "branch-456"
    },
    messageConfig: {
        type: "interactive",
        message: "Check out our products!"
    }
});
```

## API Endpoints

### REST API Endpoints

```javascript
// Send catalogue message
POST /api/catalogue-messaging/send
{
    "customerId": "customer-123",
    "catalogueId": "587001577223671",
    "messageType": "interactive",
    "message": "Check out our latest products!"
}

// Send bulk messages
POST /api/catalogue-messaging/bulk-send
{
    "customerIds": ["customer-1", "customer-2"],
    "catalogueId": "587001577223671",
    "messageType": "template",
    "templateName": "catalogue_template"
}

// Get catalogue products
GET /api/meta-catalogue/products?catalogueId=587001577223671&limit=10

// Get message history
GET /api/catalogue-messaging/history?customerId=customer-123&limit=20
```

## Message Templates

### Interactive Catalogue Message

```json
{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "+1234567890",
    "type": "interactive",
    "interactive": {
        "type": "catalog_message",
        "body": {
            "text": "Check out our latest products!"
        },
        "action": {
            "name": "catalog_message",
            "parameters": {
                "thumbnail_product_retailer_id": "product-123"
            }
        },
        "footer": {
            "text": "Happy Shopping!"
        }
    }
}
```

### Catalogue Template Message

```json
{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "+1234567890",
    "type": "template",
    "template": {
        "name": "catalogue_template",
        "language": {
            "code": "en"
        },
        "components": [
            {
                "type": "body",
                "parameters": [
                    { "type": "text", "text": "Customer Name" }
                ]
            },
            {
                "type": "button",
                "sub_type": "catalog",
                "index": "0",
                "parameters": [
                    {
                        "type": "catalog",
                        "catalog_id": "587001577223671",
                        "product_retailer_id": "product-123"
                    }
                ]
            }
        ]
    }
}
```

## Error Handling

### Common Errors

1. **Catalogue Not Found**
   - Error: `META_CATALOGUE_FETCH_ERROR`
   - Solution: Verify catalogue ID and access token

2. **Channel Not Available**
   - Error: `NO_CHANNEL_AVAILABLE`
   - Solution: Ensure WhatsApp channel is configured and active

3. **Template Not Approved**
   - Error: `CATALOGUE_TEMPLATE_ERROR`
   - Solution: Use approved template or send interactive message

### Retry Logic

The system includes automatic retry logic:
- **Temporal Workflows**: 3 retries with exponential backoff
- **API Calls**: 2 retries with 500ms delay
- **Message Sending**: 3 retries with 1s initial interval

## Testing

### Test File

Use `test-catalogue-messaging.js` to test the integration:

```bash
node test-catalogue-messaging.js
```

### Test Scenarios

1. **Fetch Catalogue Products**
2. **Send Interactive Catalogue Message**
3. **Send Catalogue Template Message**
4. **Bulk Catalogue Messaging**
5. **Webhook Handling**

## Monitoring and Analytics

### Logs

The system logs:
- Catalogue message sends
- Order processing
- Webhook events
- Error conditions

### Analytics Events

Track these events:
- `catalogue_viewed` - When customer views catalogue
- `catalogue_order_placed` - When order is placed
- `catalogue_message_sent` - When message is sent

## Security Considerations

1. **Access Tokens**: Store securely, rotate regularly
2. **Webhook Verification**: Verify webhook signatures
3. **Rate Limiting**: Implement rate limiting for API calls
4. **Data Privacy**: Ensure GDPR compliance for customer data

## Troubleshooting

### Common Issues

1. **Products Not Syncing**
   - Check Shopify integration
   - Verify Meta access token
   - Check catalogue permissions

2. **Messages Not Sending**
   - Verify WhatsApp channel configuration
   - Check BSP credentials
   - Ensure customer phone numbers are valid

3. **Orders Not Processing**
   - Check webhook configuration
   - Verify order processor service
   - Check database connections

### Debug Mode

Enable debug logging:
```javascript
// In moleculer.config.js
logger: {
    type: "Console",
    options: {
        level: "debug"
    }
}
```

## Future Enhancements

1. **Product Recommendations**: AI-powered product suggestions
2. **Inventory Sync**: Real-time inventory updates
3. **Multi-language Support**: Localized catalogue messages
4. **Analytics Dashboard**: Visual analytics for catalogue performance
5. **A/B Testing**: Test different message formats

## Support

For issues or questions:
1. Check the logs for error messages
2. Verify configuration settings
3. Test with the provided test file
4. Review Meta's documentation for API changes

## References

- [Meta Business API Documentation](https://developers.facebook.com/docs/whatsapp/business-management-api)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Meta Commerce Manager](https://business.facebook.com/commerce/)
- [Shopify Integration Guide](https://developers.facebook.com/docs/whatsapp/guides/commerce-guides/)
