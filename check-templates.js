#!/usr/bin/env node

/**
 * Script to check all available templates in the database
 */

const mongoose = require('mongoose');

// Your MongoDB connection string
const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/flowflex';

async function checkTemplates() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Your organization ID (replace with your actual org ID)
        const orgId = '683d41c15fb092a0554fdf30';
        
        console.log(`\n📋 Checking templates for org: ${orgId}\n`);

        // Check order_confirmation_templates collection
        console.log('1️⃣ Checking order_confirmation_templates collection...');
        const OrderConfirmationTemplate = require('./models/order_confirmation_templates.model');
        const orderConfirmationTemplates = await OrderConfirmationTemplate.find({
            org_id: orgId
        });
        
        console.log(`   Found ${orderConfirmationTemplates.length} templates:`);
        orderConfirmationTemplates.forEach((template, index) => {
            console.log(`   ${index + 1}. ${template.name} (${template.status}) - ${template._id}`);
        });

        // Check whatsapptemplate collection
        console.log('\n2️⃣ Checking whatsapptemplate collection...');
        const WhatsAppTemplate = require('./models/whatsapptemplate.model');
        const whatsappTemplates = await WhatsAppTemplate.find({
            org_id: orgId
        });
        
        console.log(`   Found ${whatsappTemplates.length} templates:`);
        whatsappTemplates.forEach((template, index) => {
            console.log(`   ${index + 1}. ${template.name} (${template.status}) - ${template._id}`);
            if (template.meta_templates && template.meta_templates.length > 0) {
                template.meta_templates.forEach((meta, metaIndex) => {
                    console.log(`      Meta ${metaIndex + 1}: ${meta.status} (${meta.language}) - ID: ${meta.id}`);
                });
            }
        });

        // Check specifically for order_confirmation
        console.log('\n3️⃣ Checking specifically for "order_confirmation" template...');
        const orderConfirmationTemplate = await OrderConfirmationTemplate.findOne({
            name: 'order_confirmation',
            org_id: orgId
        });
        
        const whatsappOrderConfirmation = await WhatsAppTemplate.findOne({
            name: 'order_confirmation',
            org_id: orgId
        });

        console.log(`   Order Confirmation Template: ${orderConfirmationTemplate ? 'FOUND' : 'NOT FOUND'}`);
        if (orderConfirmationTemplate) {
            console.log(`   - Status: ${orderConfirmationTemplate.status}`);
            console.log(`   - ID: ${orderConfirmationTemplate._id}`);
        }

        console.log(`   WhatsApp Template: ${whatsappOrderConfirmation ? 'FOUND' : 'NOT FOUND'}`);
        if (whatsappOrderConfirmation) {
            console.log(`   - Status: ${whatsappOrderConfirmation.status}`);
            console.log(`   - ID: ${whatsappOrderConfirmation._id}`);
            if (whatsappOrderConfirmation.meta_templates && whatsappOrderConfirmation.meta_templates.length > 0) {
                whatsappOrderConfirmation.meta_templates.forEach((meta, index) => {
                    console.log(`   - Meta ${index + 1}: ${meta.status} (${meta.language}) - ID: ${meta.id}`);
                });
            }
        }

        console.log('\n✅ Template check completed!');
        
    } catch (error) {
        console.error('❌ Error checking templates:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run the check
checkTemplates();
