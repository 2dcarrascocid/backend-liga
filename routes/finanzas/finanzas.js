import { supabase } from '../../services/db.js';
import jwt from 'jsonwebtoken';
import { validateApiKey } from '../../utils/apiKeyMiddleware.js';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "access-secret";

const getUserIdFromToken = (event) => {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader) throw new Error('No token provided');

    const token = authHeader.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
        return decoded.sub;
    } catch (err) {
        throw new Error('Invalid token');
    }
};

const verifyClubAdmin = async (clubId, userId) => {
    const { data, error } = await supabase
        .from('el_dep_clubes')
        .select('id')
        .eq('id', clubId)
        .eq('admin_id', userId)
        .single();

    return !error && !!data;
};

const verifyClubAccess = async (clubId, userId) => {
    // Check if admin
    if (await verifyClubAdmin(clubId, userId)) return true;

    // Check if player in club linked to user
    const { data, error } = await supabase
        .from('el_dep_jugadores')
        .select('id')
        .eq('club_id', clubId)
        .eq('usuario_id', userId)
        .single();

    return !error && !!data;
};

export const crearMovimiento = async (event) => {
    try {
        // Validar API Key
        const apiKeyValidation = validateApiKey(event);
        if (!apiKeyValidation.valid) {
            return apiKeyValidation.response;
        }

        const userId = getUserIdFromToken(event);
        const { clubId } = event.pathParameters;
        const body = JSON.parse(event.body);
        const { tipo, categoria, monto, descripcion, fecha_movimiento } = body;

        if (!tipo || !monto) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Tipo y monto son obligatorios' }),
            };
        }

        if (!await verifyClubAdmin(clubId, userId)) {
            return {
                statusCode: 403,
                body: JSON.stringify({ message: 'Solo el administrador puede crear movimientos' }),
            };
        }

        const { data, error } = await supabase
            .from('el_dep_movimientos_financieros')
            .insert([{
                club_id: clubId,
                tipo,
                categoria,
                monto,
                descripcion,
                fecha_movimiento: fecha_movimiento || new Date().toISOString(),
                registrado_por: userId
            }])
            .select()
            .single();

        if (error) throw error;

        return {
            statusCode: 201,
            body: JSON.stringify(data),
        };
    } catch (error) {
        return {
            statusCode: error.message === 'Invalid token' || error.message === 'No token provided' ? 401 : 500,
            body: JSON.stringify({ message: error.message }),
        };
    }
};

export const listarMovimientos = async (event) => {
    try {
        // Validar API Key
        const apiKeyValidation = validateApiKey(event);
        if (!apiKeyValidation.valid) {
            return apiKeyValidation.response;
        }

        const userId = getUserIdFromToken(event);
        const { clubId } = event.pathParameters;

        if (!await verifyClubAccess(clubId, userId)) {
            return {
                statusCode: 403,
                body: JSON.stringify({ message: 'No tienes acceso a los movimientos de este club' }),
            };
        }

        const { data, error } = await supabase
            .from('el_dep_movimientos_financieros')
            .select('*')
            .eq('club_id', clubId)
            .order('fecha_movimiento', { ascending: false });

        if (error) throw error;

        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    } catch (error) {
        return {
            statusCode: error.message === 'Invalid token' || error.message === 'No token provided' ? 401 : 500,
            body: JSON.stringify({ message: error.message }),
        };
    }
};

export const cerrarMes = async (event) => {
    try {
        // Validar API Key
        const apiKeyValidation = validateApiKey(event);
        if (!apiKeyValidation.valid) {
            return apiKeyValidation.response;
        }

        const userId = getUserIdFromToken(event);
        const { clubId } = event.pathParameters;
        const body = JSON.parse(event.body);
        const { mes, anio, observaciones } = body;

        if (!mes || !anio) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Mes y año son obligatorios' }),
            };
        }

        if (!await verifyClubAdmin(clubId, userId)) {
            return {
                statusCode: 403,
                body: JSON.stringify({ message: 'Solo el administrador puede cerrar el mes' }),
            };
        }

        // Calcular totales
        const startDate = new Date(anio, mes - 1, 1).toISOString();
        const endDate = new Date(anio, mes, 1).toISOString(); // First day of next month

        const { data: movimientos, error: movError } = await supabase
            .from('el_dep_movimientos_financieros')
            .select('tipo, monto')
            .eq('club_id', clubId)
            .gte('fecha_movimiento', startDate)
            .lt('fecha_movimiento', endDate);

        if (movError) throw movError;

        let total_ingresos = 0;
        let total_egresos = 0;

        movimientos.forEach(m => {
            if (m.tipo === 'ingreso') total_ingresos += parseFloat(m.monto);
            if (m.tipo === 'egreso') total_egresos += parseFloat(m.monto);
        });

        const saldo_final = total_ingresos - total_egresos;

        const { data, error } = await supabase
            .from('el_dep_cierres_mensuales')
            .insert([{
                club_id: clubId,
                mes,
                anio,
                total_ingresos,
                total_egresos,
                saldo_final,
                observaciones,
                cerrado_por: userId,
                fecha_cierre: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) throw error;

        return {
            statusCode: 201,
            body: JSON.stringify(data),
        };

    } catch (error) {
        return {
            statusCode: error.message === 'Invalid token' || error.message === 'No token provided' ? 401 : 500,
            body: JSON.stringify({ message: error.message }),
        };
    }
};
