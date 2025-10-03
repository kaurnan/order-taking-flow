const express = require('express');
const { PubSub } = require('@google-cloud/pubsub');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3002;

// Initialize Pub/Sub
let pubsub;
try {
    const projectRoot = path.resolve(__dirname);
    const keyFilename = path.join(projectRoot, "gcp/service_account.json");
    console.log(`🔍 Initializing Pub/Sub with project: ${process.env.GCP_PROJECT_ID}`);
    console.log(`🔍 Service account file: ${keyFilename}`);
    
    // Check if service account file exists
    const fs = require('fs');
    if (!fs.existsSync(keyFilename)) {
        console.error(`❌ Service account file not found: ${keyFilename}`);
        process.exit(1);
    }
    
    pubsub = new PubSub({ keyFilename, projectId: process.env.GCP_PROJECT_ID });
    console.log(`✅ Pub/Sub initialized successfully`);
    
    // Test Pub/Sub connection
    console.log(`🔍 Testing Pub/Sub connection...`);
    const topic = pubsub.topic('test-topic');
    console.log(`✅ Pub/Sub connection test completed`);
    
} catch (error) {
    console.error('❌ Failed to initialize Pub/Sub:', error);
    console.error('❌ Error details:', error.message);
    process.exit(1);
}

app.use(express.json());

// Shopify webhook endpoint
app.post('/shopify-webhook', async (req, res) => {
    try {
        console.log('📥 Received Shopify webhook:', req.headers['x-shopify-topic']);
        
        const topic = req.headers['x-shopify-topic'];
        const shopDomain = req.headers['x-shopify-shop-domain'];
        
        if (!topic || !shopDomain) {
            console.error('❌ Missing required headers');
            return res.status(400).json({ error: 'Missing required headers' });
        }
        
        // Map Shopify topics to Pub/Sub topics
        const topicMapping = {
            'orders/create': process.env.ORDERS_CREATE,
            'orders/cancelled': process.env.ORDERS_CANCELLED,
            'orders/updated': process.env.ORDERS_UPDATED,
            'orders/paid': process.env.ORDERS_PAID,
            'orders/fulfilled': process.env.ORDERS_FULFILLED,
            'customers/create': process.env.CUSTOMERS_CREATE,
            'customers/update': process.env.CUSTOMERS_UPDATE,
            'checkouts/create': process.env.CHECKOUTS_CREATE,
            'fulfillments/create': process.env.FULFILLMENTS_CREATE
        };
        
        const pubsubTopicName = topicMapping[topic];
        
        console.log(`🔍 Debug - Topic: ${topic}, Mapped to: ${pubsubTopicName}`);
        console.log(`🔍 Debug - ORDERS_CANCELLED env var: ${process.env.ORDERS_CANCELLED}`);
        console.log(`🔍 Debug - ORDERS_PAID env var: ${process.env.ORDERS_PAID}`);
        
        if (!pubsubTopicName) {
            console.log(`⚠️ No Pub/Sub topic mapped for: ${topic}`);
            console.log(`🔍 Available mappings:`, topicMapping);
            return res.status(200).json({ message: 'Topic not configured' });
        }
        
        // Create message for Pub/Sub
        const message = {
            data: Buffer.from(JSON.stringify(req.body)),
            attributes: {
                'X-Shopify-Topic': topic,
                'X-Shopify-Shop-Domain': shopDomain
            }
        };
        
        // Publish to Pub/Sub
        const pubsubTopic = pubsub.topic(pubsubTopicName);
        await pubsubTopic.publishMessage(message);
        
        console.log(`✅ Forwarded ${topic} to Pub/Sub topic: ${pubsubTopicName}`);
        
        res.status(200).json({ 
            success: true, 
            message: 'Webhook processed successfully',
            topic: pubsubTopicName
        });
        
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 Webhook endpoint running on port ${PORT}`);
    console.log(`📡 Shopify webhook URL: http://localhost:${PORT}/shopify-webhook`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`🔍 Debug - ORDERS_CANCELLED: ${process.env.ORDERS_CANCELLED}`);
    console.log(`🔍 Debug - ORDERS_CREATE: ${process.env.ORDERS_CREATE}`);
    console.log(`🔍 Debug - ORDERS_PAID: ${process.env.ORDERS_PAID}`);
    console.log(`✅ Webhook endpoint is ready to receive requests!`);
});

// Add error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('❌ Stack trace:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Keep the process alive
process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Keep the process alive
setInterval(() => {
    // Just keep the process alive
}, 1000);
