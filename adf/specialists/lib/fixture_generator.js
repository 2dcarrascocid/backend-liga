/**
 * Fixture Generator (pure helpers, sin dependencias de DB)
 *
 * Algoritmos de sorteo/generación de calendario reutilizados por
 * tournaments_specialist.js:
 *   - generateRoundRobin  → Todos contra Todos (liga continua)
 *   - generateGroups      → Distribución en grupos (seeding serpiente)
 *   - generateKnockoutBracket → Eliminación directa (con byes y
 *     progresión de llave vía slots), usado también para formatos
 *     mixtos (grupos + playoffs) y para la liguilla/ronda de consuelo
 *     cuando se arma como llave en vez de tabla.
 *
 * Todas las funciones trabajan sobre arrays de IDs (string) y
 * estructuras planas — no tocan la base de datos, por lo que se
 * pueden probar de forma aislada.
 */

/**
 * Método del círculo para Todos contra Todos.
 * Soporta cantidad impar de equipos (agrega un "bye" que se descarta).
 *
 * @param {string[]} teamIds
 * @param {{ double?: boolean }} options - double=true genera ida y vuelta
 * @returns {{ home: string, away: string }[][]} rondas → partidos
 */
export function generateRoundRobin(teamIds, { double = false } = {}) {
  const teams = [...teamIds];
  if (teams.length < 2) return [];

  const hasBye = teams.length % 2 !== 0;
  if (hasBye) teams.push(null);

  const n = teams.length;
  const arr = [...teams];
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const roundPairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null || b === null) continue;
      // Alterna localía por ronda para repartir partidos de local/visita
      roundPairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(roundPairs);
    arr.splice(1, 0, arr.pop());
  }

  if (double) {
    const mirrored = rounds.map((round) =>
      round.map(({ home, away }) => ({ home: away, away: home }))
    );
    return [...rounds, ...mirrored];
  }

  return rounds;
}

/**
 * Distribuye equipos en grupos usando seeding serpiente (snake),
 * de forma que la fuerza relativa quede balanceada entre grupos
 * cuando el orden de entrada respeta el sembrado (seed).
 *
 * @param {string[]} teamIds - en orden de seed (mejor sembrado primero)
 * @param {number} groupCount
 * @returns {{ name: string, teams: string[] }[]}
 */
export function generateGroups(teamIds, groupCount) {
  const count = Math.max(1, parseInt(groupCount, 10) || 1);
  const groups = Array.from({ length: count }, () => []);

  teamIds.forEach((id, idx) => {
    const cycle = Math.floor(idx / count);
    const posInCycle = idx % count;
    const groupIndex = cycle % 2 === 0 ? posInCycle : count - 1 - posInCycle;
    groups[groupIndex].push(id);
  });

  return groups.map((teams, i) => ({ name: String.fromCharCode(65 + i), teams }));
}

const nextPowerOfTwo = (n) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/**
 * Genera el orden de posiciones sembradas para un cuadro de tamaño
 * `size` (potencia de 2), con el algoritmo recursivo estándar que
 * evita que los mejores sembrados se enfrenten antes de rondas finales.
 */
const seedPositions = (size) => {
  let positions = [1, 2];
  while (positions.length < size) {
    const len = positions.length;
    const next = [];
    for (let i = 0; i < len; i++) {
      const s = positions[i];
      next.push(s, len * 2 + 1 - s);
    }
    positions = next;
  }
  return positions;
};

/**
 * Genera un cuadro de Eliminación Directa (Playoffs) a partir de una
 * lista de equipos ya sembrada (mejor seed primero). Devuelve rondas
 * de "slots" en vez de filas de BD — el specialist que llama a esta
 * función es responsable de insertar los partidos y resolver los
 * `home_source_match_id`/`away_source_match_id` reales con los ids
 * devueltos por la base de datos, usando `homeSourceSlot`/`awaySourceSlot`
 * como referencia (roundIndex + slot de la ronda anterior).
 *
 * Si el número de equipos no es potencia de 2, los mejores sembrados
 * reciben "bye" en primera ronda: esos partidos se generan igual como
 * partidos WALKOVER auto-resueltos (isBye=true) para que el mecanismo
 * de propagación de ganador funcione de forma genérica y uniforme.
 *
 * @param {string[]} teamIds - equipos en orden de seed
 * @param {{ twoLegged?: boolean, thirdPlace?: boolean }} options
 */
export function generateKnockoutBracket(teamIds, { twoLegged = false, thirdPlace = false } = {}) {
  const teams = [...teamIds];
  if (teams.length < 2) return { rounds: [], thirdPlaceMatch: null };

  const bracketSize = nextPowerOfTwo(teams.length);
  const positions = seedPositions(bracketSize);
  const seedToTeam = (seed) => teams[seed - 1] ?? null;

  const rounds = [];

  // Ronda 1: arma los enfrentamientos según el sembrado, incluyendo byes.
  const firstRound = [];
  for (let i = 0; i < bracketSize; i += 2) {
    const home = seedToTeam(positions[i]);
    const away = seedToTeam(positions[i + 1]);
    const isBye = home === null || away === null;
    const legs = !isBye && twoLegged ? [1, 2] : [1];
    firstRound.push({
      slot: i / 2,
      homeTeamId: isBye ? (home ?? away) : home,
      awayTeamId: isBye ? null : away,
      isBye,
      homeSourceSlot: null,
      awaySourceSlot: null,
      legs,
    });
  }
  rounds.push(firstRound);

  // Rondas siguientes: participantes TBD, enlazados a la ronda anterior.
  let prevRoundSize = firstRound.length;
  let roundIndex = 1;
  while (prevRoundSize > 1) {
    const round = [];
    const size = prevRoundSize / 2;
    for (let slot = 0; slot < size; slot++) {
      const legs = twoLegged ? [1, 2] : [1];
      round.push({
        slot,
        homeTeamId: null,
        awayTeamId: null,
        isBye: false,
        homeSourceSlot: { roundIndex: roundIndex - 1, slot: slot * 2 },
        awaySourceSlot: { roundIndex: roundIndex - 1, slot: slot * 2 + 1 },
        legs,
      });
    }
    rounds.push(round);
    prevRoundSize = size;
    roundIndex++;
  }

  let thirdPlaceMatch = null;
  if (thirdPlace && rounds.length >= 2) {
    const semiRoundIndex = rounds.length - 2;
    thirdPlaceMatch = {
      slot: 0,
      homeTeamId: null,
      awayTeamId: null,
      isBye: false,
      // El 3er/4to lugar lo juegan los PERDEDORES de semifinales
      homeSourceSlot: { roundIndex: semiRoundIndex, slot: 0, isLoser: true },
      awaySourceSlot: { roundIndex: semiRoundIndex, slot: 1, isLoser: true },
      legs: [1],
    };
  }

  return { rounds, thirdPlaceMatch, bracketSize };
}
