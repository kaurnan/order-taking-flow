const axios = require('axios');

async function debugWhatsApp() {
    try {
        console.log('🔍 Debugging WhatsApp integration...');
        
        // Test with a simple order
        const testData = {
            id: 12345,
            order_number: "DEBUG-001",
            customer: {
                first_name: "Test",
                last_name: "User",
                email: "test@example.com",
                phone: "+919876543210"
            },
            line_items: [
                {
                    name: "Debug Product",
                    quantity: 1,
                    price: "10.00"
                }
            ],
            total_price: "10.00",
            currency: "USD"
        };
        
        console.log('📦 Sending test order...');
        console.log('Test data:', JSON.stringify(testData, null, 2));
        
        const response = await axios.post('http://localhost:3001/api/shopify-data-process', testData, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 second timeout
        });
        
        console.log('✅ Response status:', response.status);
        console.log('✅ Response data:', response.data);
        
        // Wait a bit for processing
        console.log('⏳ Waiting 3 seconds for processing...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('🎯 Test completed. Check the console where npm run dev is running for detailed logs.');
        
    } catch (error) {
        console.error('❌ Debug test failed:');
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
        console.error('Message:', error.message);
    }
}

debugWhatsApp();
