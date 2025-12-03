import { handlerLocal } from '../routes/partidos/listarSolicitudesPendientes.js';

// Mock event
const event = {
    queryStringParameters: {
        owner_id: '123e4567-e89b-12d3-a456-426614174000'
    }
};

async function runTest() {
    console.log('Testing listarSolicitudesPendientes handler (MOCK)...');

    // Set mock env var
    process.env.USE_DB_MOCK = 'true';

    const response = await handlerLocal(event);
    console.log('Response:', response);

    if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        if (body.solicitudes && Array.isArray(body.solicitudes)) {
            console.log('✅ Test Passed: Solicitudes returned');
        } else {
            console.log('❌ Test Failed: Invalid response structure');
        }
    } else {
        console.log('❌ Test Failed: Status code ' + response.statusCode);
    }
}

runTest();
