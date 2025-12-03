import { handlerLocal } from '../routes/partidos/solicitarIngreso.js';

// Mock event
const event = {
    body: JSON.stringify({
        jugador_id: '123e4567-e89b-12d3-a456-426614174000',
        partido_id: '987fcdeb-51a2-43c1-9876-543210987654'
    })
};

async function runTest() {
    console.log('Testing solicitarIngreso handler (MOCK)...');

    // Set mock env var
    process.env.USE_DB_MOCK = 'true';

    const response = await handlerLocal(event);
    console.log('Response:', response);

    if (response.statusCode === 201) {
        console.log('✅ Test Passed');
    } else {
        console.log('❌ Test Failed');
    }
}

runTest();
