const axios = require('axios');

async function checkWhatsAppConfig() {
    try {
        console.log('🔍 Checking WhatsApp service configuration...');
        
        // Check if WhatsApp service is responding
        console.log('1. Testing WhatsApp service availability...');
        
        try {
            const response = await axios.get('http://localhost:3001/api/whatsapp/health', {
                timeout: 5000
            });
            console.log('✅ WhatsApp service is responding:', response.status);
        } catch (error) {
            console.log('❌ WhatsApp service health check failed:', error.message);
        }
        
        // Test with different phone number formats
        console.log('\n2. Testing different phone number formats...');
        
        const phoneFormats = [
            "+919876543210",  // Indian with +
            "919876543210",   // Indian without +
            "+1234567890",    // US with +
            "1234567890"      // US without +
        ];
        
        for (const phone of phoneFormats) {
            console.log(`\n📱 Testing phone: ${phone}`);
            
            try {
                const testData = {
                    to: phone,
                    body: `Test message for ${phone}`,
                    type: "text"
                };
                
                const response = await axios.post('http://localhost:3001/api/whatsapp/sendMessage', testData, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                });
                
                console.log(`   Status: ${response.status}`);
                console.log(`   Data: ${JSON.stringify(response.data)}`);
                
            } catch (error) {
                console.log(`   ❌ Error: ${error.response?.data || error.message}`);
            }
        }
        
        console.log('\n3. Checking environment variables...');
        console.log('WA_PHONE_NUMBER_ID:', process.env.WA_PHONE_NUMBER_ID || 'NOT SET');
        console.log('CLOUD_API_ACCESS_TOKEN:', process.env.CLOUD_API_ACCESS_TOKEN ? 'SET' : 'NOT SET');
        console.log('FACEBOOK_APP_ID:', process.env.FACEBOOK_APP_ID || 'NOT SET');
        
    } catch (error) {
        console.error('❌ Configuration check failed:', error.message);
    }
}

checkWhatsAppConfig();
