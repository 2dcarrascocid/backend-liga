import dotenv from 'dotenv';
dotenv.config();
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL_LIGA;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_LIGA;

console.log('--- Debugging Supabase Configuration ---');

if (!key) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY_LIGA is missing in .env');
    process.exit(1);
}

// 1. Decode JWT to check role
try {
    const decoded = jwt.decode(key);
    console.log('Key Role:', decoded.role);
    if (decoded.role !== 'service_role') {
        console.error('⚠️ WARNING: The provided key is NOT a service_role key. It is:', decoded.role);
        console.error('   RLS policies will apply. This is likely the cause of the 42501 error.');
    } else {
        console.log('✅ Key is a valid service_role key.');
    }
} catch (e) {
    console.error('❌ Failed to decode key:', e.message);
}

// 2. Check Database Connection and Schema
const supraLiga = createClient(url, key, { db: { schema: 'liga' } });

async function checkTable(client, schemaName) {
    console.log(`\nChecking access to schema: '${schemaName}'...`);
    const { data, error } = await client.from('organizations').select('count', { count: 'exact', head: true });

    if (error) {
        console.error(`❌ Error accessing 'organizations' in '${schemaName}':`, error.message);
        if (error.code === '42P01') console.error('   (Table does not exist)');
        if (error.code === '42501') console.error('   (RLS Violation)');
    } else {
        console.log(`✅ Successfully accessed 'organizations' in '${schemaName}'.`);
    }
}

(async () => {
    await checkTable(supraLiga, 'liga');
})();
