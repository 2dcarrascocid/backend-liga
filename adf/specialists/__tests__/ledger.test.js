import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInscriptionCharge } from '../lib/ledger.js';
import { createMockDb } from './test_utils/mock_db.js';

test('createInscriptionCharge usa el amount explícito (costo propio del torneo) sin consultar el catálogo por temporada', async () => {
  let insertedRow = null;
  const db = createMockDb(
    {
      // Si el código consultara el catálogo por error, este error haría fallar el test
      // (no debería llamarse cuando se pasa `amount` explícito).
      lg_season_cost_catalog: [{ data: null, error: new Error('no debería consultarse el catálogo cuando se pasa amount explícito') }],
      lg_ledger_entries: [(payload) => ({ data: { id: 'entry-1', ...payload }, error: null })],
    },
    { onInsert: (table, payload) => { if (table === 'lg_ledger_entries') insertedRow = payload; } }
  );

  const result = await createInscriptionCharge(
    { orgId: 'org-1', clubId: 'club-1', seriesId: null, tournamentId: 't-1', seasonId: 's-1', amount: 25000 },
    db
  );

  assert.equal(result.error, null);
  assert.equal(insertedRow.amount, 25000);
  assert.equal(insertedRow.series_id, null);
  assert.equal(insertedRow.club_id, 'club-1');
  assert.equal(insertedRow.tournament_id, 't-1');
  assert.equal(insertedRow.category, 'INSCRIPCION');
});

test('createInscriptionCharge cae al catálogo por temporada cuando no se pasa amount (compatibilidad histórica)', async () => {
  let insertedRow = null;
  const db = createMockDb(
    {
      lg_season_cost_catalog: [{ data: { inscription_fee: 10000, matchday_fee: 500 }, error: null }],
      lg_ledger_entries: [(payload) => ({ data: { id: 'entry-2', ...payload }, error: null })],
    },
    { onInsert: (table, payload) => { if (table === 'lg_ledger_entries') insertedRow = payload; } }
  );

  const result = await createInscriptionCharge(
    { orgId: 'org-1', clubId: 'club-1', seriesId: 'series-1', tournamentId: 't-1', seasonId: 's-1' },
    db
  );

  assert.equal(result.error, null);
  assert.equal(insertedRow.amount, 10000);
  assert.equal(insertedRow.series_id, 'series-1');
});
