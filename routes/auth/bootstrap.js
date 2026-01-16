import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { handleError, AppError } from '../../utils/errors.js';
import { validateBody } from '../../utils/validator.js';
import { validateApiKey, extractBearerToken } from '../../utils/security.js';

export const handler = async (event) => {
  try {
    // 1. Security Checks
    validateApiKey(event);
    const token = extractBearerToken(event);

    // 2. Validate Token & Get User
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
    }

    const userId = user.id;

    // 3. Parse Body
    const { org_name, org_slug, country_code } = validateBody(event.body, ['org_name']);

    // Generate slug if not provided (simple version)
    const finalSlug = org_slug || org_name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

    // 4. Create Organization (Idempotent-ish)
    // Check if exists first to avoid unique violation errors or handle them
    let orgId;
    let orgData;

    // Check by slug
    const { data: existingOrgSlug } = await supabaseAdmin
      .from('lg_orgs')
      .select('*')
      .eq('slug', finalSlug)
      .single();

    if (existingOrgSlug) {
        orgId = existingOrgSlug.id;
        orgData = existingOrgSlug;
    } else {
        // Create new
        const { data: newOrg, error: createError } = await supabaseAdmin
        .from('lg_orgs')
        .insert({
            name: org_name,
            slug: finalSlug,
            country_code: country_code || 'CL'
        })
        .select()
        .single();

        if (createError) {
            // Handle race condition or other errors
            if (createError.code === '23505') { // Unique violation
                 throw new AppError('Organization with this slug already exists', 409, 'CONFLICT');
            }
            throw new AppError(createError.message, 500, createError.code);
        }
        orgId = newOrg.id;
        orgData = newOrg;
    }

    // 5. Assign Admin Role
    // Upsert to handle if already exists
    const { error: roleError } = await supabaseAdmin
      .from('lg_org_users')
      .upsert({
        org_id: orgId,
        user_id: userId,
        role: 'ADMIN'
      }, { onConflict: 'org_id,user_id,role' });

    if (roleError) {
        throw new AppError(roleError.message, 500, roleError.code);
    }

    // 6. Seed Sports Catalog (if empty)
    // First check if any sport exists
    const { count } = await supabaseAdmin
        .from('lg_sports')
        .select('*', { count: 'exact', head: true });

    if (count === 0) {
        const sports = [
            { name: 'Futbol', team_sport: true },
            { name: 'Basketball', team_sport: true },
            { name: 'Tennis', team_sport: false },
            { name: 'Volleyball', team_sport: true }
        ];
        
        const { error: seedError } = await supabaseAdmin
            .from('lg_sports')
            .upsert(sports, { onConflict: 'name' });
            
        if (seedError) {
             console.error('Error seeding sports:', seedError);
             // Don't fail the whole request for this
        }
    }

    return successResponse({
      org: orgData,
      role: 'ADMIN'
    });

  } catch (error) {
    return handleError(error);
  }
};
