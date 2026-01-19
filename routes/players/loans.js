import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { validateBody } from '../../utils/validator.js';
import { validateApiKey, extractBearerToken } from '../../utils/security.js';

const getAuthUser = async (event) => {
  validateApiKey(event);
  const token = extractBearerToken(event);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized: Invalid token');
  return user;
};

export const requestLoan = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { playerId } = event.pathParameters;
    const body = validateBody(event.body, ['to_club_id', 'loan_type', 'start_date']);

    // Find current active club for the player
    const { data: currentRoster, error: rosterError } = await supabaseAdmin
      .from('lg_club_rosters')
      .select('club_id, club:lg_clubs(org_id)')
      .eq('player_id', playerId)
      .eq('status', 'ACTIVE')
      .single();

    if (rosterError || !currentRoster) {
      return errorResponse('Player is not active in any club', 400, 'PLAYER_NOT_ACTIVE');
    }

    const fromClubId = currentRoster.club_id;
    const orgId = currentRoster.club.org_id;

    if (fromClubId === body.to_club_id) {
      return errorResponse('Cannot loan to the same club', 400, 'INVALID_CLUB');
    }

    const { data, error } = await supabaseAdmin
      .from('lg_player_loans')
      .insert({
        org_id: orgId,
        player_id: playerId,
        from_club_id: fromClubId,
        to_club_id: body.to_club_id,
        loan_type: body.loan_type, // 'LOAN' or 'TRANSFER'
        status: 'PENDING',
        start_date: body.start_date,
        end_date: body.end_date,
        requested_by_user_id: user.id
      })
      .select()
      .single();

    if (error) throw error;

    return successResponse({ loan: data }, 201);
  } catch (error) {
    console.error('requestLoan Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const approveLoan = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { loanId } = event.pathParameters;

    // Fetch loan details
    const { data: loan, error: loanError } = await supabaseAdmin
      .from('lg_player_loans')
      .select('*')
      .eq('id', loanId)
      .single();

    if (loanError || !loan) return errorResponse('Loan not found', 404);
    if (loan.status !== 'PENDING') return errorResponse('Loan is not pending', 400);

    // TODO: Permission check (decided_by_user_id) - Admin or To/From Club Manager?
    
    // Execute Transactional Logic (Sequential)
    // 1. Deactivate in from_club
    const { error: deactError } = await supabaseAdmin
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', loan.player_id)
      .eq('club_id', loan.from_club_id)
      .eq('status', 'ACTIVE');

    if (deactError) throw deactError;

    // 2. Activate in to_club
    const { error: actError } = await supabaseAdmin
      .from('lg_club_rosters')
      .insert({
        club_id: loan.to_club_id,
        player_id: loan.player_id,
        status: 'ACTIVE',
        valid_from: new Date().toISOString()
      });

    if (actError) {
      // Rollback logic would go here (reactivate in from_club)
      // For now, we just throw error, data might be inconsistent
      console.error('CRITICAL: Failed to activate player in new club after deactivation', actError);
      throw actError;
    }

    // 3. Update Loan status
    const { data, error } = await supabaseAdmin
      .from('lg_player_loans')
      .update({
        status: 'APPROVED',
        decided_by_user_id: user.id
      })
      .eq('id', loanId)
      .select()
      .single();

    if (error) throw error;

    return successResponse({ loan: data });
  } catch (error) {
    console.error('approveLoan Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const rejectLoan = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { loanId } = event.pathParameters;

    const { data, error } = await supabaseAdmin
      .from('lg_player_loans')
      .update({
        status: 'REJECTED',
        decided_by_user_id: user.id
      })
      .eq('id', loanId)
      .select()
      .single();

    if (error) throw error;

    return successResponse({ loan: data });
  } catch (error) {
    console.error('rejectLoan Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const returnLoan = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { loanId } = event.pathParameters;

    const { data: loan, error: loanError } = await supabaseAdmin
      .from('lg_player_loans')
      .select('*')
      .eq('id', loanId)
      .single();

    if (loanError || !loan) return errorResponse('Loan not found', 404);
    if (loan.status !== 'APPROVED') return errorResponse('Loan is not approved (active)', 400);

    // Sequential Logic
    // 1. Deactivate in to_club (current club)
    const { error: deactError } = await supabaseAdmin
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', loan.player_id)
      .eq('club_id', loan.to_club_id)
      .eq('status', 'ACTIVE');

    if (deactError) throw deactError;

    // 2. Activate in from_club (original club)
    const { error: actError } = await supabaseAdmin
      .from('lg_club_rosters')
      .insert({
        club_id: loan.from_club_id,
        player_id: loan.player_id,
        status: 'ACTIVE',
        valid_from: new Date().toISOString()
      });

    if (actError) {
      console.error('CRITICAL: Failed to return player to original club', actError);
      throw actError;
    }

    // 3. Update Loan status
    const { data, error } = await supabaseAdmin
      .from('lg_player_loans')
      .update({
        status: 'RETURNED'
      })
      .eq('id', loanId)
      .select()
      .single();

    if (error) throw error;

    return successResponse({ loan: data });
  } catch (error) {
    console.error('returnLoan Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};
