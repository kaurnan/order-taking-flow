const express = require('express');
const { Connection, Client } = require('@temporalio/client');

const app = express();
const PORT = process.env.TEMPORAL_GATEWAY_PORT || 3003;

// Middleware
app.use(express.json());

// Temporal client setup with error handling
let client;
let connection;

async function initializeTemporalClient() {
    try {
        // Use a simpler connection approach
        connection = await Connection.connect({
            address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
        });

        client = new Client({
            connection,
            namespace: process.env.TEMPORAL_NAMESPACE || 'default',
        });

        console.log('Temporal client initialized successfully');
        console.log(`Connected to Temporal server at: ${process.env.TEMPORAL_ADDRESS || 'localhost:7233'}`);
        console.log(`Using namespace: ${process.env.TEMPORAL_NAMESPACE || 'default'}`);
    } catch (error) {
        console.error('Error initializing Temporal client:', error);
        throw error;
    }
}

// Routes
app.post('/exec-shopify', async (req, res) => {
    try {
        if (!client) {
            await initializeTemporalClient();
        }

        const { name, orderData, customerData, orgData } = req.body;
        
        console.log(`Starting ${name} workflow for order: ${orderData.id}`);
        
        const workflowId = `order-confirmation-${orderData.id}`;
        
        // Check if workflow already exists
        try {
            const existingHandle = client.workflow.getHandle(workflowId);
            const existingResult = await existingHandle.result();
            console.log(`Workflow already completed with result:`, existingResult);
            
            res.json({
                success: true,
                workflowId: workflowId,
                result: existingResult,
                message: "Workflow already completed"
            });
            return;
        } catch (error) {
            // Workflow doesn't exist, continue with starting new one
            console.log(`No existing workflow found, starting new one`);
        }
        
        // Start the workflow using the workflow type name (the actual function name)
        console.log(`🚀 Starting workflow 'OrderConfirmationWorkflow' with ID: ${workflowId}`);
        console.log(`📋 Task Queue: order-confirmation-queue`);
        console.log(`🏢 Namespace: default`);
        
        const handle = await client.workflow.start('OrderConfirmationWorkflow', {
            args: [orderData, customerData, orgData],
            taskQueue: 'order-confirmation-queue',
            workflowId: workflowId,
        });
        
        console.log(`✅ Workflow started successfully with ID: ${handle.workflowId}`);
        console.log(`🔗 Run ID: ${handle.firstExecutionRunId}`);
        
        // Don't wait for completion - let it run asynchronously so it appears in UI
        // The workflow will complete in the background and be visible in Temporal UI
        
        res.json({
            success: true,
            workflowId: handle.workflowId,
            message: "Workflow started successfully"
        });
        
    } catch (error) {
        console.error('Error executing workflow:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Order Cancellation Route
app.post('/exec-shopify-cancellation', async (req, res) => {
    try {
        if (!client) {
            await initializeTemporalClient();
        }

        const { name, orderData, customerData, orgData } = req.body;
        
        console.log(`Starting ${name} workflow for order cancellation: ${orderData.id}`);
        
        const workflowId = `order-cancellation-${orderData.id}`;
        
        // Check if workflow already exists
        try {
            const existingHandle = client.workflow.getHandle(workflowId);
            const existingResult = await existingHandle.result();
            console.log(`Cancellation workflow already completed with result:`, existingResult);
            
            res.json({
                success: true,
                workflowId: workflowId,
                result: existingResult,
                message: "Cancellation workflow already completed"
            });
            return;
        } catch (error) {
            // Workflow doesn't exist, continue with starting new one
            console.log(`No existing cancellation workflow found, starting new one`);
        }
        
        // Start the workflow using the workflow type name
        const handle = await client.workflow.start('OrderCancellationWorkflow', {
            args: [orderData, customerData, orgData],
            taskQueue: 'order-cancellation-queue',
            workflowId: workflowId,
        });
        
        console.log(`Cancellation workflow started with ID: ${handle.workflowId}`);
        
        // Wait for the workflow to complete
        const result = await handle.result();
        
        console.log(`Cancellation workflow completed with result:`, result);
        
        res.json({
            success: true,
            workflowId: handle.workflowId,
            result: result
        });
        
    } catch (error) {
        console.error('Error executing cancellation workflow:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Catalogue Messaging Route
app.post('/exec-catalogue-messaging', async (req, res) => {
    try {
        if (!client) {
            await initializeTemporalClient();
        }

        const { customerData, catalogueData, orgData, messageConfig } = req.body;
        
        console.log(`Starting catalogue messaging workflow for customer: ${customerData.phone}`);
        console.log(`Catalogue ID: ${catalogueData.catalogueId}`);
        console.log(`Message type: ${messageConfig.type || 'interactive'}`);
        
        const workflowId = `catalogue-messaging-${customerData.phone}-${Date.now()}`;
        
        // Check if workflow already exists
        try {
            const existingHandle = client.workflow.getHandle(workflowId);
            const existingResult = await existingHandle.result();
            console.log(`Catalogue messaging workflow already completed with result:`, existingResult);
            
            res.json({
                success: true,
                workflowId: workflowId,
                result: existingResult,
                message: "Catalogue messaging workflow already completed"
            });
            return;
        } catch (error) {
            // Workflow doesn't exist, continue with starting new one
            console.log(`No existing catalogue messaging workflow found, starting new one`);
        }
        
        // Start the workflow using the workflow type name
        const handle = await client.workflow.start('CatalogueMessagingWorkflow', {
            args: [customerData, catalogueData, orgData, messageConfig],
            taskQueue: 'catalogue-messaging-queue',
            workflowId: workflowId,
        });
        
        console.log(`Catalogue messaging workflow started with ID: ${handle.workflowId}`);
        
        // Wait for the workflow to complete
        const result = await handle.result();
        
        console.log(`Catalogue messaging workflow completed with result:`, result);
        
        res.json({
            success: true,
            workflowId: handle.workflowId,
            result: result,
            message: "Catalogue messaging workflow completed successfully"
        });
        
    } catch (error) {
        console.error('Error executing catalogue messaging workflow:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: "Failed to execute catalogue messaging workflow"
        });
    }
});

// Back-in-Stock Notification Route
app.post('/exec-back-in-stock', async (req, res) => {
    try {
        if (!client) {
            await initializeTemporalClient();
        }

        const { name, productData, backInStockVariants, subscriptions, orgData } = req.body;
        
        console.log(`Starting ${name} workflow for back-in-stock notifications: ${productData.id}`);
        console.log(`Product: ${productData.title}`);
        console.log(`Variants back in stock: ${backInStockVariants.length}`);
        console.log(`Subscriptions to notify: ${subscriptions.length}`);
        
        const workflowId = `back-in-stock-${productData.id}-${Date.now()}`;
        
        // Check if workflow already exists
        try {
            const existingHandle = client.workflow.getHandle(workflowId);
            const existingResult = await existingHandle.result();
            console.log(`Back-in-stock workflow already completed with result:`, existingResult);
            
            res.json({
                success: true,
                workflowId: workflowId,
                result: existingResult,
                message: "Back-in-stock workflow already completed"
            });
            return;
        } catch (error) {
            // Workflow doesn't exist, continue with starting new one
            console.log(`No existing back-in-stock workflow found, starting new one`);
        }
        
        // Start the workflow using the workflow type name
        const handle = await client.workflow.start('BackInStockWorkflow', {
            args: [productData, backInStockVariants, subscriptions, orgData],
            taskQueue: 'back-in-stock-queue',
            workflowId: workflowId,
        });
        
        console.log(`Back-in-stock workflow started with ID: ${handle.workflowId}`);
        
        // Wait for the workflow to complete
        const result = await handle.result();
        
        console.log(`Back-in-stock workflow completed with result:`, result);
        
        res.json({
            success: true,
            workflowId: handle.workflowId,
            result: result
        });
        
    } catch (error) {
        console.error('Error executing back-in-stock workflow:', error);
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
        temporal: client ? 'connected' : 'disconnected'
    });
});

// Start server
app.listen(PORT, async () => {
    console.log(`Temporal Gateway running on port ${PORT}`);
    console.log(`Temporal Server: ${process.env.TEMPORAL_ADDRESS || 'localhost:7233'}`);
    console.log(`Namespace: ${process.env.TEMPORAL_NAMESPACE || 'default'}`);
    
    // Initialize Temporal client
    try {
        await initializeTemporalClient();
    } catch (error) {
        console.error('Failed to initialize Temporal client:', error);
        console.log('Gateway will start but Temporal features may not work');
    }
});

module.exports = app;