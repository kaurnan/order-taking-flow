#!/usr/bin/env node

/**
 * Quick Start Script for Meta Catalogue Integration
 * 
 * This script helps you get started with the Meta catalogue integration
 * by checking your setup and running basic tests.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log("🚀 Meta Catalogue Integration - Quick Start\n");

// Check if required files exist
function checkFiles() {
    console.log("📁 Checking required files...");
    
    const requiredFiles = [
        'services/integration/meta-catalogue.service.js',
        'services/communication/catalogue-messaging.service.js',
        'services/temporal/catalogue-messaging.workflow.js',
        'test-integration-simple.js',
        'SETUP_GUIDE.md',
        'docs/META_CATALOGUE_INTEGRATION.md'
    ];
    
    let allFilesExist = true;
    
    requiredFiles.forEach(file => {
        if (fs.existsSync(file)) {
            console.log(`   ✅ ${file}`);
        } else {
            console.log(`   ❌ ${file} - Missing!`);
            allFilesExist = false;
        }
    });
    
    if (allFilesExist) {
        console.log("\n✅ All required files are present!\n");
    } else {
        console.log("\n❌ Some files are missing. Please check your setup.\n");
    }
    
    return allFilesExist;
}

// Check environment variables
function checkEnvironment() {
    console.log("🔧 Checking environment configuration...");
    
    const requiredEnvVars = [
        'CLOUD_API_ACCESS_TOKEN', // Your existing Meta access token
        'FACEBOOK_APP_ID', // Your existing Facebook app ID
        'WA_PHONE_NUMBER_ID', // Your existing phone number ID
        'INTERAKT_API', // Your existing Interakt API
        'INTERAKT_TOKEN' // Your existing Interakt token
    ];
    
    const missingVars = [];
    
    requiredEnvVars.forEach(varName => {
        if (process.env[varName]) {
            console.log(`   ✅ ${varName} is set`);
        } else {
            console.log(`   ❌ ${varName} is not set`);
            missingVars.push(varName);
        }
    });
    
    if (missingVars.length === 0) {
        console.log("\n✅ All environment variables are configured!\n");
        return true;
    } else {
        console.log(`\n❌ Missing environment variables: ${missingVars.join(', ')}`);
        console.log("   Please set these in your .env file or environment.\n");
        return false;
    }
}

// Check package.json dependencies
function checkDependencies() {
    console.log("📦 Checking dependencies...");
    
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const requiredDeps = [
        'moleculer',
        'axios',
        '@temporalio/client',
        '@temporalio/worker',
        '@temporalio/workflow'
    ];
    
    let allDepsPresent = true;
    
    requiredDeps.forEach(dep => {
        if (packageJson.dependencies[dep] || packageJson.devDependencies[dep]) {
            console.log(`   ✅ ${dep} is installed`);
        } else {
            console.log(`   ❌ ${dep} is not installed`);
            allDepsPresent = false;
        }
    });
    
    if (allDepsPresent) {
        console.log("\n✅ All required dependencies are installed!\n");
    } else {
        console.log("\n❌ Some dependencies are missing. Run: npm install\n");
    }
    
    return allDepsPresent;
}

// Show next steps
function showNextSteps() {
    console.log("📋 Next Steps:\n");
    
    console.log("1. 🔧 Configure Environment Variables:");
    console.log("   Create a .env file with your Meta credentials:");
    console.log("   META_ACCESS_TOKEN=your_token_here");
    console.log("   META_APP_ID=your_app_id_here");
    console.log("   WA_PHONE_NUMBER_ID=your_phone_id_here");
    console.log("   INTERAKT_API=https://api.interakt.ai");
    console.log("   INTERAKT_TOKEN=your_interakt_token_here\n");
    
    console.log("2. 🏢 Set up Meta Business Account:");
    console.log("   - Create Meta Business Account");
    console.log("   - Set up WhatsApp Business API");
    console.log("   - Create catalogue in Commerce Manager");
    console.log("   - Connect Shopify to Meta catalogue\n");
    
    console.log("3. 🧪 Test the Integration:");
    console.log("   node test-integration-simple.js\n");
    
    console.log("4. 🚀 Start the Services:");
    console.log("   npm run dev");
    console.log("   npm run temporal:gateway");
    console.log("   npm run temporal:worker");
    console.log("   npm run webhook:endpoint\n");
    
    console.log("5. 📚 Read the Documentation:");
    console.log("   - SETUP_GUIDE.md - Complete setup guide");
    console.log("   - docs/META_CATALOGUE_INTEGRATION.md - Full documentation\n");
}

// Main function
async function main() {
    console.log("🔍 Meta Catalogue Integration - Quick Start Check\n");
    
    const filesOk = checkFiles();
    const envOk = checkEnvironment();
    const depsOk = checkDependencies();
    
    console.log("📊 Summary:");
    console.log(`   Files: ${filesOk ? '✅' : '❌'}`);
    console.log(`   Environment: ${envOk ? '✅' : '❌'}`);
    console.log(`   Dependencies: ${depsOk ? '✅' : '❌'}\n`);
    
    if (filesOk && depsOk) {
        console.log("🎉 You're ready to start! Follow the next steps below.\n");
        showNextSteps();
        
        if (envOk) {
            console.log("🚀 Ready to test! Run: node test-integration-simple.js");
        } else {
            console.log("⚠️  Please configure your environment variables first.");
        }
    } else {
        console.log("❌ Please fix the issues above before proceeding.");
    }
}

// Run the quick start check
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
