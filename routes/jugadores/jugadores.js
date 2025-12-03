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

const verifyClubOwnership = async (clubId, userId) => {
    const { data, error } = await supabase
        .from('el_dep_clubes')
        .select('id')
        .eq('id', clubId)
        .eq('admin_id', userId)
        .single();

    if (error || !data) return false;
    return true;
};

export const crear = async (event) => {
    try {
        // Validar API Key
        const apiKeyValidation = validateApiKey(event);
        if (!apiKeyValidation.valid) {
            return apiKeyValidation.response;
        }

        const userId = getUserIdFromToken(event);
        const { clubId } = event.pathParameters;
        const body = JSON.parse(event.body);
        const { nombre_completo, rut, email, telefono, fecha_nacimiento, es_socio, usuario_id } = body;

        if (!nombre_completo) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'El nombre completo es obligatorio' }),
            };
        }

        const isOwner = await verifyClubOwnership(clubId, userId);
        if (!isOwner) {
            return {
                statusCode: 403,
                body: JSON.stringify({ message: 'No tienes permisos para administrar este club' }),
            };
        }

        const { data, error } = await supabase
            .from('el_dep_jugadores')
            .insert([{
                club_id: clubId,
                usuario_id: usuario_id || null,
                nombre_completo,
                rut,
                email,
                telefono,
                fecha_nacimiento,
                es_socio: es_socio || false
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

export const listar = async (event) => {
    try {
        // Validar API Key
        const apiKeyValidation = validateApiKey(event);
        if (!apiKeyValidation.valid) {
            return apiKeyValidation.response;
        }

        const userId = getUserIdFromToken(event);
        const { clubId } = event.pathParameters;

        // Optional: Check ownership or membership. 
        // Requirement says "El usuario basico puede tener acceso a visualizar todos los libros...", 
        // but for players, usually only admin or the players themselves.
        // Assuming for now only admin sees the full list or maybe members too.
        // Let's enforce ownership for now as per "El admninistradoir puede administrar alta y baja de jugadores".

        const isOwner = await verifyClubOwnership(clubId, userId);
        if (!isOwner) {
            // Maybe allow if user is part of the club? For now strict admin.
            return {
                statusCode: 403,
                body: JSON.stringify({ message: 'No tienes permisos para ver este club' }),
            };
        }

        const { data, error } = await supabase
            .from('el_dep_jugadores')
            .select('*')
            .eq('club_id', clubId);

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
