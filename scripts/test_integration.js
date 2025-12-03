// scripts/test_integration.js
// Este script prueba el flujo completo del sistema: Registro -> Login -> Club -> Jugador -> Finanzas

const API_URL = 'http://localhost:3000';

async function request(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Agregar API Key si está configurada
    const apiKey = process.env.API_KEY;
    if (apiKey) headers['x-api-key'] = apiKey;

    const options = {
        method,
        headers,
    };

    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_URL}${path}`, options);
        const data = await response.json();
        return { status: response.status, data };
    } catch (error) {
        console.error(`Error en request ${path}:`, error.message);
        return { status: 500, data: null };
    }
}

async function runTest() {
    console.log('🚀 Iniciando Test de Integración...\n');

    // 1. Registro
    const randomId = Math.floor(Math.random() * 10000);
    const email = `test${randomId}@example.com`;
    const password = 'Password123!';

    console.log(`1. Registrando usuario: ${email}`);
    const regRes = await request('POST', '/auth/register', {
        email,
        password,
        nombre: 'Usuario Test',
        apellido: 'Demo'
    });

    if (regRes.status !== 201) {
        console.error('❌ Error en registro:', regRes.data);
        return;
    }
    console.log('✅ Usuario registrado OK\n');

    // 2. Login
    console.log('2. Iniciando sesión');
    const loginRes = await request('POST', '/auth/login', { email, password });

    if (loginRes.status !== 200) {
        console.error('❌ Error en login:', loginRes.data);
        return;
    }

    const token = loginRes.data.tokens.access_token;
    console.log('✅ Login OK. Token obtenido.\n');

    // 3. Crear Club
    console.log('3. Creando Club');
    const clubRes = await request('POST', '/clubes', {
        nombre: `Club Deportivo Test ${randomId}`,
        descripcion: 'Un club de prueba'
    }, token);

    if (clubRes.status !== 201) {
        console.error('❌ Error creando club:', clubRes.data);
        return;
    }
    const clubId = clubRes.data.id;
    console.log(`✅ Club creado ID: ${clubId}\n`);

    // 4. Crear Jugador
    console.log('4. Creando Jugador en el Club');
    const playerRes = await request('POST', `/clubes/${clubId}/jugadores`, {
        nombre_completo: 'Juan Jugador',
        rut: '12.345.678-9',
        email: 'juan@club.com',
        es_socio: true
    }, token);

    if (playerRes.status !== 201) {
        console.error('❌ Error creando jugador:', playerRes.data);
    } else {
        console.log('✅ Jugador creado OK\n');
    }

    // 5. Registrar Ingreso
    console.log('5. Registrando Ingreso Financiero');
    const ingresoRes = await request('POST', `/clubes/${clubId}/finanzas/movimientos`, {
        tipo: 'ingreso',
        categoria: 'cuota',
        monto: 15000,
        descripcion: 'Cuota mensual Juan',
        fecha_movimiento: new Date().toISOString()
    }, token);

    if (ingresoRes.status !== 201) {
        console.error('❌ Error registrando ingreso:', ingresoRes.data);
    } else {
        console.log('✅ Ingreso registrado OK\n');
    }

    // 6. Registrar Egreso
    console.log('6. Registrando Egreso Financiero');
    const egresoRes = await request('POST', `/clubes/${clubId}/finanzas/movimientos`, {
        tipo: 'egreso',
        categoria: 'insumos',
        monto: 5000,
        descripcion: 'Compra de balones',
        fecha_movimiento: new Date().toISOString()
    }, token);

    if (egresoRes.status !== 201) {
        console.error('❌ Error registrando egreso:', egresoRes.data);
    } else {
        console.log('✅ Egreso registrado OK\n');
    }

    // 7. Listar Movimientos
    console.log('7. Listando Movimientos');
    const listMovRes = await request('GET', `/clubes/${clubId}/finanzas/movimientos`, null, token);
    if (listMovRes.status === 200) {
        console.log(`✅ Movimientos encontrados: ${listMovRes.data.length}\n`);
    } else {
        console.error('❌ Error listando movimientos:', listMovRes.data);
    }

    // 8. Cerrar Mes
    console.log('8. Cerrando Mes (Mes actual)');
    const today = new Date();
    const cierreRes = await request('POST', `/clubes/${clubId}/finanzas/cierre`, {
        mes: today.getMonth() + 1,
        anio: today.getFullYear(),
        observaciones: 'Cierre de prueba automático'
    }, token);

    if (cierreRes.status !== 201) {
        console.error('❌ Error cerrando mes:', cierreRes.data);
    } else {
        console.log('✅ Mes cerrado OK. Saldo Final:', cierreRes.data.saldo_final);
    }

    console.log('\n🏁 Test Finalizado.');
}

runTest();
