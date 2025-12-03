import { handlerLocal } from '../routes/partidos/responderSolicitud.js';

// Mock event
const event = {
    body: JSON.stringify({
        solicitud_id: '123e4567-e89b-12d3-a456-426614174000',
        estado: 'aceptado'
    })
};

async function runTest() {
    console.log('Testing responderSolicitud handler (MOCK)...');

    // Set mock env var
    process.env.USE_DB_MOCK = 'true';

    const response = await handlerLocal(event);
    console.log('Response:', response);

    if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        if (body.message && body.message.includes('aceptado')) {
            console.log('✅ Test Passed: Solicitud aceptada');
        } else {
            console.log('❌ Test Failed: Unexpected message');
        }
    } else {
        console.log('❌ Test Failed: Status code ' + response.statusCode);
    }
}

runTest();
