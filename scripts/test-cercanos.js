import { handlerLocal } from '../routes/partidos/buscarCercanos.js';

// Mock event
const event = {
    queryStringParameters: {
        lat: '-33.45',
        lng: '-70.66',
        radio: '100'
    }
};

// Mock Supabase response (since we can't easily mock the import without a test runner)
// We will rely on the handler's error handling if DB connection fails, 
// OR we can set USE_DB_MOCK=true if the handler supported it (it doesn't yet).
// Let's just run it and see if it fails gracefully or connects.
// Ideally we should modify the handler to support mock data for testing like other handlers.

async function runTest() {
    console.log('Testing buscarCercanos handler...');
    const response = await handlerLocal(event);
    console.log('Response:', response);
}

runTest();
