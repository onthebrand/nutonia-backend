
import 'dotenv/config';

async function testUpstashHTTP() {
    const url = process.env.REDIS_URL;
    if (!url) {
        console.error('❌ REDIS_URL not found');
        return;
    }

    console.log('Testing Upstash HTTP (REST) connection...');
    
    // Extract info from redis://default:PASSWORD@HOST:PORT
    const match = url.match(/rediss?:\/\/default:([^@]+)@([^:]+)/);
    if (!match) {
        console.error('❌ Could not parse REDIS_URL');
        return;
    }

    const [_, password, host] = match;
    const restUrl = `https://${host}`;

    try {
        console.log(`Fetching: ${restUrl}/set/test/working`);
        const response = await fetch(`${restUrl}/set/test/working?_token=${password}`);
        const data = await response.json();
        console.log('✅ Upstash REST Response:', data);
        
        const getResponse = await fetch(`${restUrl}/get/test?_token=${password}`);
        const getData = await getResponse.json();
        console.log('✅ Upstash GET Response:', getData);
    } catch (err: any) {
        console.error('❌ Upstash REST Error:', err.message);
    }
}

testUpstashHTTP();
