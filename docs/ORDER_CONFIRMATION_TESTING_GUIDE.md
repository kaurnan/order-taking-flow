# Order Confirmation Workflow Testing Guide

This guide will help you test the complete order confirmation workflow from Shopify order creation to WhatsApp message delivery.

## Prerequisites

1. ✅ **Flowflex Application Running** - `npm run dev`
2. ✅ **Shopify Development Store** - Set up and configured
3. ✅ **WhatsApp Business Account** - With approved templates
4. ✅ **Temporal Server** - Running and accessible
5. ✅ **MongoDB** - Connected and accessible
6. ✅ **Redis** - Running for caching and queues

## Step 1: Set Up Shopify Integration

### 1.1 Create Shopify App
```bash
# In your Shopify Partner Dashboard
# Create a new app with these settings:
# - App URL: https://your-ngrok-url.ngrok.io
# - Allowed redirection URL: https://your-ngrok-url.ngrok.io/auth/callback
```

### 1.2 Get Access Token
```bash
# In your app settings, generate an access token
# Copy the token for the next step
```

### 1.3 Integrate with Flowflex
```bash
curl -X POST http://localhost:3001/api/integrations/shopify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "shop_domain": "your-store.myshopify.com",
    "access_token": "your_shopify_access_token"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Shopify integration saved successfully"
}
```

## Step 2: Create WhatsApp Template

### 2.1 Create Order Confirmation Template
```bash
curl -X POST http://localhost:3001/api/order-confirmation-template \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "order_confirmation",
    "language": "en",
    "orgId": "your_org_id",
    "branchId": "your_branch_id"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Order confirmation template created successfully",
  "data": {
    "template": {
      "_id": "template_id",
      "name": "order_confirmation",
      "status": "PENDING"
    },
    "approvalStatus": {
      "status": "PENDING",
      "estimatedApprovalTime": "24-48 hours"
    }
  }
}
```

### 2.2 Approve Template (For Testing)
```bash
# Update template status to approved for testing
curl -X PUT http://localhost:3001/api/order-confirmation-template/TEMPLATE_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "status": "APPROVED"
  }'
```

## Step 3: Test Order Processing

### 3.1 Create Test Order Data
```json
{
  "id": "test_order_123",
  "order_number": "1001",
  "name": "#1001",
  "total_price": "29.99",
  "currency": "USD",
  "created_at": "2024-01-15T10:30:00Z",
  "financial_status": "paid",
  "fulfillment_status": "unfulfilled",
  "customer": {
    "id": "customer_123",
    "first_name": "John",
    "last_name": "Doe",
    "email": "john.doe@example.com",
    "phone": "+1234567890"
  },
  "line_items": [
    {
      "id": "item_1",
      "name": "Test T-Shirt",
      "quantity": 1,
      "price": "19.99"
    },
    {
      "id": "item_2", 
      "name": "Test Mug",
      "quantity": 1,
      "price": "9.99"
    }
  ],
  "shipping_address": {
    "address1": "123 Main St",
    "city": "New York",
    "province": "NY",
    "country": "United States",
    "zip": "10001"
  }
}
```

### 3.2 Process Test Order
```bash
curl -X POST http://localhost:3001/api/process-order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "orderData": {
      "id": "test_order_123",
      "order_number": "1001",
      "name": "#1001",
      "total_price": "29.99",
      "currency": "USD",
      "created_at": "2024-01-15T10:30:00Z",
      "financial_status": "paid",
      "fulfillment_status": "unfulfilled",
      "customer": {
        "id": "customer_123",
        "first_name": "John",
        "last_name": "Doe",
        "email": "john.doe@example.com",
        "phone": "+1234567890"
      },
      "line_items": [
        {
          "id": "item_1",
          "name": "Test T-Shirt",
          "quantity": 1,
          "price": "19.99"
        }
      ],
      "shipping_address": {
        "address1": "123 Main St",
        "city": "New York",
        "province": "NY",
        "country": "United States",
        "zip": "10001"
      }
    },
    "customerData": {
      "id": "customer_123",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john.doe@example.com",
      "phone": "+1234567890"
    },
    "orgId": "your_org_id",
    "branchId": "your_branch_id"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Order processed successfully",
  "data": {
    "orderId": "order_document_id",
    "workflowId": "temporal_workflow_id",
    "customerId": "customer_document_id"
  }
}
```

## Step 4: Check Order Status

### 4.1 Get Order Status
```bash
curl -X GET http://localhost:3001/api/order-status/ORDER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_document_id",
    "shopifyOrderId": "test_order_123",
    "status": "completed",
    "workflowId": "temporal_workflow_id",
    "workflowStatus": "completed",
    "messageSent": true,
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:05Z"
  }
}
```

## Step 5: Test Real Shopify Order

### 5.1 Create Test Product in Shopify
1. Go to your Shopify admin
2. Products → Add product
3. Create a simple product (e.g., "Test Product - $10")
4. Save the product

### 5.2 Place Test Order
1. Go to your store frontend
2. Add the test product to cart
3. Proceed to checkout
4. Use test payment details:
   - Card: 4242 4242 4242 4242
   - Expiry: Any future date
   - CVC: Any 3 digits
5. Complete the order

### 5.3 Monitor Logs
```bash
# Watch the application logs
# You should see:
# 1. Shopify webhook received
# 2. Order processing started
# 3. Temporal workflow executed
# 4. WhatsApp message sent
```

## Step 6: Verify WhatsApp Message

### 6.1 Check WhatsApp Delivery
- The customer should receive a WhatsApp message with:
  - Order confirmation
  - Order number
  - Total amount
  - Item count
  - Thank you message

### 6.2 Check Database Records
```bash
# Check if order was saved
curl -X GET http://localhost:3001/api/order-status/ORDER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Check if customer was created/updated
curl -X GET http://localhost:3001/api/audience/CUSTOMER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Troubleshooting

### Common Issues

1. **Shopify Integration Failed**
   - Check access token validity
   - Verify shop domain format
   - Ensure webhooks are registered

2. **Temporal Workflow Failed**
   - Check Temporal server connection
   - Verify workflow definition
   - Check activity implementations

3. **WhatsApp Message Not Sent**
   - Verify template approval status
   - Check customer phone number format
   - Ensure WhatsApp Business API credentials

4. **Order Processing Stuck**
   - Check Redis connection
   - Verify MongoDB connection
   - Check service dependencies

### Debug Commands

```bash
# Check service health
curl -X GET http://localhost:3001/api/db-health

# Check Redis connection
redis-cli ping

# Check MongoDB connection
mongo --eval "db.adminCommand('ping')"

# Check Temporal connection
curl -X GET http://localhost:8080/api/v1/namespaces
```

## Success Criteria

✅ **Shopify Integration**: Store connected successfully  
✅ **Template Creation**: WhatsApp template created and approved  
✅ **Order Processing**: Order data processed correctly  
✅ **Workflow Execution**: Temporal workflow completed successfully  
✅ **Message Delivery**: WhatsApp message sent to customer  
✅ **Database Updates**: All records saved correctly  

## Next Steps

1. **Production Setup**: Configure production Shopify store
2. **Template Approval**: Submit templates to WhatsApp for approval
3. **Monitoring**: Set up monitoring and alerting
4. **Error Handling**: Implement retry logic and dead letter queues
5. **Analytics**: Add tracking and analytics for order confirmations
