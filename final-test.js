const axios = require('axios');

async function finalTest() {
    try {
        console.log('🎯 Final test of the complete order confirmation system...');
        
        // Test with real data from your database
        const testData = {
            id: 12345,
            order_number: "FINAL-TEST-001",
            customer: {
                first_name: "Test",
                last_name: "Customer",
                email: "test@example.com",
                phone: "+917023081263" // Your phone number
            },
            line_items: [
                {
                    name: "Test Product",
                    quantity: 1,
                    price: "50.00"
                }
            ],
            total_price: "50.00",
            currency: "USD"
        };
        
        console.log('📦 Sending test order with real phone number...');
        console.log('Customer Phone:', testData.customer.phone);
        
        const response = await axios.post('http://localhost:3001/api/shopify-data-process', testData, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        console.log('✅ Webhook response:', response.status, response.data);
        
        // Wait for processing
        console.log('⏳ Waiting 5 seconds for WhatsApp message processing...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('\n🎉 Final test completed!');
        console.log('📱 Check the phone number +918593938312 for the WhatsApp message');
        console.log('📋 The message should contain:');
        console.log('   - Order confirmation');
        console.log('   - Order number: FINAL-TEST-001');
        console.log('   - Customer name: Test Customer');
        console.log('   - Total amount: USD 50.00');
        
    } catch (error) {
        console.error('❌ Final test failed:', error.response?.data || error.message);
    }
}

finalTest();
