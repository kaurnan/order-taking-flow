const axios = require('axios');

async function debugPhoneNumber() {
    try {
        console.log('🔍 Debugging phone number issue...');
        
        // Test with different phone number formats
        const testNumbers = [
            "+919876543210",  // Indian format
            "919876543210",   // Without +
            "+1234567890",    // US format
            "1234567890"      // US without +
        ];
        
        for (const phone of testNumbers) {
            console.log(`\n📱 Testing phone number: ${phone}`);
            
            const testData = {
                id: 12345,
                order_number: "TEST-001",
                customer: {
                    first_name: "John",
                    last_name: "Doe",
                    email: "john.doe@example.com",
                    phone: phone
                },
                line_items: [
                    {
                        name: "Test Product",
                        quantity: 2,
                        price: "25.00"
                    }
                ],
                total_price: "50.00",
                currency: "USD"
            };
            
            try {
                const response = await axios.post('http://localhost:3001/api/shopify-data-process', testData, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                console.log(`✅ Response for ${phone}:`, response.status);
                
            } catch (error) {
                console.log(`❌ Error for ${phone}:`, error.response?.data || error.message);
            }
            
            // Wait between requests
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
    }
}

debugPhoneNumber();
