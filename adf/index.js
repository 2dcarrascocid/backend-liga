/**
 * ADF - Registry & Entry Point
 *
 * Inicializa y registra todas las Skills del sistema ADF.
 * Exporta la instancia única del AgentOrchestrator.
 *
 * Estructura de capas:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │           ORCHESTRATOR LAYER                │
 *   │         AgentOrchestrator                   │
 *   │   (planifica, coordina, registra evidencia) │
 *   └──────────────┬───────────────┬──────────────┘
 *                  │               │
 *   ┌──────────────▼───┐   ┌───────▼──────────────┐
 *   │  VALIDATORS LAYER│   │  SPECIALISTS LAYER    │
 *   │  - SecurityValid.│   │  - AuthSpecialist        │
 *   │  - RequestValid. │   │  - ClubsSpecialist       │
 *   │  - BusinessValid.│   │  - PlayersSpecialist     │
 *   └──────────────────┘   │  - LoansSpecialist       │
 *                          │  - CategoriesSpecialist  │
 *                          │  - TransfersSpecialist   │
 *                          └──────────────────────────┘
 *   ┌─────────────────────────────────────────────┐
 *   │           OBSERVABILITY LAYER               │
 *   │   ArtifactLogger + TraceBuilder             │
 *   │   (evidencia, métricas, auditoría)          │
 *   └─────────────────────────────────────────────┘
 *
 * Uso básico:
 *
 *   import { adf } from '../adf/index.js';
 *   import { createTask } from '../adf/contracts/task_schema.js';
 *
 *   const task = createTask({ type: 'CREATE_PLAYER', domain: 'players', input: {...} });
 *   const result = await adf.orchestrator.execute(task, { apiKey, bearerToken, supabase: db });
 */

// Contracts
export { Skill } from './contracts/skill_contract.js';
export { createTask, createTaskResult, createSkillResult, TaskStatus, ArtifactType } from './contracts/task_schema.js';

// Observability
export { ArtifactLogger } from './observability/artifact_logger.js';
export { TraceBuilder, StepStatus } from './observability/trace_builder.js';

// Validators
export { RequestValidator, ValidationRules } from './validators/request_validator.js';
export { SecurityValidator } from './validators/security_validator.js';
export { BusinessValidator, BusinessRules } from './validators/business_validator.js';

// Specialists
export { AuthSpecialist } from './specialists/auth_specialist.js';
export { ClubsSpecialist } from './specialists/clubs_specialist.js';
export { PlayersSpecialist } from './specialists/players_specialist.js';
export { LoansSpecialist } from './specialists/loans_specialist.js';
export { CategoriesSpecialist } from './specialists/categories_specialist.js';
export { TransfersSpecialist } from './specialists/transfers_specialist.js';
export { PlayerDocumentsSpecialist } from './specialists/player_documents_specialist.js';

// Orchestrator
export { AgentOrchestrator } from './orchestrator/agent_orchestrator.js';

// Adapters
export {
  buildTask,
  extractHeaders,
  extractMeta,
  taskResultToLambdaResponse,
  withADF,
} from './adapters/lambda_adapter.js';

// ── ADF Singleton ──────────────────────────────────────────────────────────────
// Inicializa la instancia única del ADF con todas las Skills registradas.
// Se importa una sola vez por proceso Lambda (Lambda warm starts reusan esto).

import { AgentOrchestrator as _AgentOrchestrator } from './orchestrator/agent_orchestrator.js';
import { RequestValidator as _RequestValidator } from './validators/request_validator.js';
import { SecurityValidator as _SecurityValidator } from './validators/security_validator.js';
import { BusinessValidator as _BusinessValidator } from './validators/business_validator.js';
import { AuthSpecialist as _AuthSpecialist } from './specialists/auth_specialist.js';
import { ClubsSpecialist as _ClubsSpecialist } from './specialists/clubs_specialist.js';
import { PlayersSpecialist as _PlayersSpecialist } from './specialists/players_specialist.js';
import { LoansSpecialist as _LoansSpecialist } from './specialists/loans_specialist.js';
import { CategoriesSpecialist as _CategoriesSpecialist } from './specialists/categories_specialist.js';
import { TransfersSpecialist as _TransfersSpecialist } from './specialists/transfers_specialist.js';
import { PlayerDocumentsSpecialist as _PlayerDocumentsSpecialist } from './specialists/player_documents_specialist.js';
import { supabaseAdmin } from '../services/db.js';

const _validators = {
  request: new _RequestValidator(),
  security: new _SecurityValidator(),
  business: new _BusinessValidator(),
};

const _specialists = {
  auth:       new _AuthSpecialist(),
  clubs:      new _ClubsSpecialist(),
  players:    new _PlayersSpecialist(),
  loans:      new _LoansSpecialist(),
  categories: new _CategoriesSpecialist(),
  transfers:        new _TransfersSpecialist(),
  player_documents: new _PlayerDocumentsSpecialist(),
};

const _orchestrator = new _AgentOrchestrator({
  specialists: _specialists,
  validators: _validators,
});

/**
 * Instancia singleton del ADF.
 * Usar `adf.orchestrator.execute(task, ctx)` para ejecutar tareas.
 */
export const adf = {
  orchestrator: _orchestrator,
  validators: _validators,
  specialists: _specialists,

  /**
   * Retorna el contexto de runtime estándar para el orchestrator.
   * Puede extenderse con bearerToken y apiKey en cada handler.
   */
  getRuntime() {
    return {
      supabase: supabaseAdmin,
      db: supabaseAdmin,
    };
  },

  /**
   * Retorna el describe() de todas las skills registradas.
   * Útil para introspección y documentación automática.
   */
  describe() {
    const allSkills = [
      ...Object.values(_validators),
      ...Object.values(_specialists),
    ];
    return {
      orchestrator: 'AgentOrchestrator v1.0.0',
      validators: Object.fromEntries(
        Object.entries(_validators).map(([k, v]) => [k, v.describe()])
      ),
      specialists: Object.fromEntries(
        Object.entries(_specialists).map(([k, v]) => [k, v.describe()])
      ),
      totalSkills: allSkills.length,
      registeredAt: new Date().toISOString(),
    };
  },
};
