import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { validateApiKey, extractBearerToken } from '../../utils/security.js';

const getAuthUser = async (event) => {
  validateApiKey(event);
  const token = extractBearerToken(event);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized: Invalid token');
  return user;
};

// Obtiene org_id a partir del clubId
const getOrgId = async (clubId) => {
  const { data, error } = await supabaseAdmin
    .from('lg_clubs')
    .select('org_id')
    .eq('id', clubId)
    .single();
  if (error || !data) throw new Error('Club not found');
  return data.org_id;
};

// GET /clubs/:clubId/categories
export const listCategories = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const orgId = await getOrgId(clubId);

    const { data, error } = await supabaseAdmin
      .from('lg_categories')
      .select('*')
      .eq('org_id', orgId)
      .order('age_from', { ascending: true, nullsFirst: true });

    if (error) throw error;
    return successResponse({ data });
  } catch (error) {
    console.error('listCategories Error:', error);
    return errorResponse(error.message, 500);
  }
};

// POST /clubs/:clubId/categories
export const createCategory = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const body = JSON.parse(event.body);

    const { name, color, age_from, age_to, description } = body;
    if (!name) return errorResponse('El campo name es requerido', 400, 'MISSING_FIELDS');

    const orgId = await getOrgId(clubId);

    const { data, error } = await supabaseAdmin
      .from('lg_categories')
      .insert({
        org_id:      orgId,
        name,
        color:       color       ?? '#6366f1',
        age_from:    age_from    ?? null,
        age_to:      age_to      ?? null,
        description: description ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return successResponse({ category: data }, 201);
  } catch (error) {
    console.error('createCategory Error:', error);
    return errorResponse(error.message, 500);
  }
};

// PATCH /clubs/:clubId/categories/:categoryId
export const updateCategory = async (event) => {
  try {
    await getAuthUser(event);
    const { categoryId } = event.pathParameters;
    const body = JSON.parse(event.body);

    const updates = {};
    if ('name'        in body) updates.name        = body.name;
    if ('color'       in body) updates.color       = body.color;
    if ('age_from'    in body) updates.age_from    = body.age_from;
    if ('age_to'      in body) updates.age_to      = body.age_to;
    if ('description' in body) updates.description = body.description;

    const { data, error } = await supabaseAdmin
      .from('lg_categories')
      .update(updates)
      .eq('id', categoryId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return errorResponse('Category not found', 404, 'CATEGORY_NOT_FOUND');
    return successResponse({ category: data });
  } catch (error) {
    console.error('updateCategory Error:', error);
    return errorResponse(error.message, 500);
  }
};

// DELETE /clubs/:clubId/categories/:categoryId
export const deleteCategory = async (event) => {
  try {
    await getAuthUser(event);
    const { categoryId } = event.pathParameters;

    const { error } = await supabaseAdmin
      .from('lg_categories')
      .delete()
      .eq('id', categoryId);

    if (error) throw error;
    return successResponse({ success: true });
  } catch (error) {
    console.error('deleteCategory Error:', error);
    return errorResponse(error.message, 500);
  }
};
