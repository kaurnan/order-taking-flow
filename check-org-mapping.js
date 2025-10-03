const mongoose = require('mongoose');
require('dotenv').config();

async function checkOrgMapping() {
    try {
        console.log('🔍 Checking organization mapping...');
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');
        
        // Check the org ID being used in the logs
        const testOrgId = "683d41c15fb092a0554fdf30"; // Correct org ID (Reviewbit)
        
        console.log(`\n📋 Checking channels for org: ${testOrgId}`);
        
        const ChannelModel = require('./models/channel.model');
        const channels = await ChannelModel.find({
            org_id: testOrgId,
            deleted: { $ne: true }
        });
        
        console.log(`Found ${channels.length} channels for this org:`);
        channels.forEach((channel, index) => {
            console.log(`\nChannel ${index + 1}:`);
            console.log(`  ID: ${channel._id}`);
            console.log(`  Phone: ${channel.phone_number_details?.display_phone_number}`);
            console.log(`  WABA ID: ${channel.waba_id}`);
        });
        
        // Check all org IDs in channels
        console.log(`\n📋 All organization IDs in channels:`);
        const allChannels = await ChannelModel.find({ deleted: { $ne: true } });
        const orgIds = [...new Set(allChannels.map(ch => ch.org_id.toString()))];
        orgIds.forEach(orgId => {
            const count = allChannels.filter(ch => ch.org_id.toString() === orgId).length;
            console.log(`  ${orgId}: ${count} channels`);
        });
        
        await mongoose.disconnect();
        console.log('\n✅ Organization mapping check completed');
        
    } catch (error) {
        console.error('❌ Organization mapping check failed:', error.message);
    }
}

checkOrgMapping();
