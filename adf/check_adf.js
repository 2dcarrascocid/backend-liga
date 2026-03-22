/**
 * ADF Health Check
 * Verifica que todos los skills están registrados y el orchestrator funciona.
 *
 * Uso: node adf/check_adf.js
 */

import { adf, createTask } from './index.js';

console.log('\n🔍 ADF Health Check\n' + '─'.repeat(50));

// 1. Describe el registro completo
const info = adf.describe();
console.log(`\n✅ Orchestrator:  ${info.orchestrator}`);
console.log(`✅ Total Skills:  ${info.totalSkills}`);

console.log('\n📦 Validators:');
for (const [name, desc] of Object.entries(info.validators)) {
  console.log(`   - ${desc.name} v${desc.version}`);
}

console.log('\n🎯 Specialists:');
for (const [name, desc] of Object.entries(info.specialists)) {
  const caps = desc.contract?.input?.length ?? '?';
  console.log(`   - ${desc.name} v${desc.version}  (domain: ${desc.domain})`);
}

// 2. Verifica que createTask funciona
const task = createTask({
  type: 'LOGIN_LOCAL',
  domain: 'auth',
  input: { email: 'test@test.com', password: '123456' },
  meta: { requestId: 'check-001' },
});

console.log('\n📋 Task de prueba creada:');
console.log(`   taskId:  ${task.taskId}`);
console.log(`   type:    ${task.type}`);
console.log(`   domain:  ${task.domain}`);
console.log(`   status:  ${task.status}`);
console.log(`   meta.requestId: ${task.meta.requestId}`);

// 3. Verifica que los specialists tienen las capabilities esperadas
const expectedCapabilities = {
  auth:    ['LOGIN_LOCAL', 'LOGIN_GOOGLE', 'LOGIN_FACEBOOK', 'BOOTSTRAP'],
  clubs:   ['CREATE_CLUB', 'GET_CLUBS', 'GET_CLUB', 'UPDATE_CLUB', 'ADD_CLUB_USER', 'REMOVE_CLUB_USER', 'ADD_ROSTER', 'GET_ROSTER', 'UPDATE_ROSTER'],
  players: ['CREATE_PLAYER', 'GET_PLAYER', 'LIST_PLAYERS_BY_CLUB', 'LIST_PLAYERS_BY_ORG', 'UPDATE_PLAYER', 'UPDATE_STATUS', 'CHANGE_CLUB'],
  loans:   ['REQUEST_LOAN', 'APPROVE_LOAN', 'REJECT_LOAN', 'RETURN_LOAN', 'LIST_LOANS'],
};

console.log('\n🧪 Verificando capabilities de Specialists:');
let allOk = true;
for (const [domain, caps] of Object.entries(expectedCapabilities)) {
  const specialist = adf.specialists[domain];
  const missing = caps.filter(c => !specialist?.capabilities?.includes(c));
  if (missing.length === 0) {
    console.log(`   ✅ ${domain}_specialist — ${caps.length} capabilities OK`);
  } else {
    console.log(`   ❌ ${domain}_specialist — falta: ${missing.join(', ')}`);
    allOk = false;
  }
}

// 4. Verifica que el orchestrator tiene los specialists inyectados
console.log('\n🔗 Verificando inyección en Orchestrator:');
const domains = ['auth', 'clubs', 'players', 'loans'];
for (const d of domains) {
  const ok = !!adf.orchestrator.specialists[d];
  console.log(`   ${ok ? '✅' : '❌'} specialists.${d}`);
  if (!ok) allOk = false;
}

const validatorNames = ['request', 'security', 'business'];
for (const v of validatorNames) {
  const ok = !!adf.orchestrator.validators[v];
  console.log(`   ${ok ? '✅' : '❌'} validators.${v}`);
  if (!ok) allOk = false;
}

// 5. Resultado final
console.log('\n' + '─'.repeat(50));
if (allOk) {
  console.log('✅ ADF está ACTIVO y completamente operativo.\n');
} else {
  console.log('❌ ADF tiene problemas — revisa los errores arriba.\n');
  process.exit(1);
}
