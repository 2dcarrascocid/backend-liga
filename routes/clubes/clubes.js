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

export const crear = async (event) => {
    try {
        // Validar API Key
        const apiKeyValidation = validateApiKey(event);
        if (!apiKeyValidation.valid) {
            return apiKeyValidation.response;
        }

        const userId = getUserIdFromToken(event);
        const body = JSON.parse(event.body);
        const { nombre, descripcion } = body;

        if (!nombre) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'El nombre del club es obligatorio' }),
            };
        }

        const { data, error } = await supabase
            .from('el_dep_clubes')
            .insert([{ nombre, descripcion, admin_id: userId }])
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

export const listar = async (event) => {
    try {
        // Validar API Key
        const apiKeyValidation = validateApiKey(event);
        if (!apiKeyValidation.valid) {
            return apiKeyValidation.response;
        }

        const userId = getUserIdFromToken(event);

        const { data, error } = await supabase
            .from('el_dep_clubes')
            .select('*')
            .eq('admin_id', userId);

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
