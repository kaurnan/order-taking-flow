const express = require('express');

const app = express();
const PORT = process.env.TEMPORAL_GATEWAY_PORT || 3000;

// Middleware
app.use(express.json());

// Routes
app.post('/exec-shopify', async (req, res) => {
    try {
        const { name, orderData, customerData, orgData } = req.body;
        
        console.log(`Simulating ${name} workflow for order: ${orderData.id}`);
        console.log(`Customer: ${customerData.name} (${customerData.email})`);
        console.log(`Order total: ${orderData.currency} ${orderData.total_price}`);
        
        // Simulate workflow execution for now
        const result = {
            success: true,
            orderId: orderData.id,
            messageId: `msg_${Date.now()}`,
            timestamp: new Date().toISOString()
        };
        
        console.log(`Workflow completed with result:`, result);
        
        res.json({
            success: true,
            workflowId: `order-confirmation-${orderData.id}`,
            result: result
        });
        
    } catch (error) {
        console.error('Error executing workflow:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        temporal: 'simulated'
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`Temporal Gateway (Simulated) running on port ${PORT}`);
    console.log(`Temporal Server: ${process.env.TEMPORAL_ADDRESS || 'localhost:7233'}`);
    console.log(`Namespace: ${process.env.TEMPORAL_NAMESPACE || 'default'}`);
    console.log('Note: Using simulated workflow execution');
    console.log('Gateway is ready to receive requests...');
});

// Handle server errors
server.on('error', (error) => {
    console.error('Server error:', error);
});

// Handle process termination
process.on('SIGINT', () => {
    console.log('\nShutting down Temporal Gateway...');
    server.close(() => {
        console.log('Gateway stopped');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\nShutting down Temporal Gateway...');
    server.close(() => {
        console.log('Gateway stopped');
        process.exit(0);
    });
});

// Keep the process alive
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit, just log the error
});

module.exports = app;
