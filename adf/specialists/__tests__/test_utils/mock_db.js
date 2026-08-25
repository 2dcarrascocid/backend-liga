/**
 * Mock mínimo de un cliente estilo supabase-js para tests unitarios sin DB.
 *
 * `createMockDb(queues)` recibe un objeto { tableName: [respuesta1, respuesta2, ...] }.
 * Cada llamada a `db.from(tableName)` devuelve un builder encadenable (select,
 * eq, neq, in, is, order, range, limit, insert, update, delete, maybeSingle,
 * single) que siempre retorna `this`, y es "thenable": al hacer `await` sobre
 * el builder (en cualquier punto de la cadena) se resuelve con la siguiente
 * respuesta en cola para esa tabla (FIFO), simulando el orden real en que el
 * código bajo test realiza sus llamadas a esa tabla.
 *
 * No es un emulador de SQL — no filtra ni interpreta los `.eq()/.in()`, solo
 * reproduce la forma { data, error, count } que el código consume.
 *
 * `onInsert(table, payload)` / `onUpdate(table, payload)` (opcionales) se
 * invocan con el payload exacto pasado a `.insert()/.update()` — útil para
 * asserts sobre qué se intentó escribir. Además, si la respuesta en cola es
 * una función, se le pasa ese mismo payload (del insert o del update, el que
 * se haya llamado en esa cadena) como argumento.
 */
export function createMockDb(queues, { onInsert, onUpdate } = {}) {
  const state = {};
  for (const table of Object.keys(queues)) {
    state[table] = [...queues[table]];
  }

  return {
    from(table) {
      let lastWritePayload;
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        neq() { return builder; },
        in() { return builder; },
        is() { return builder; },
        order() { return builder; },
        range() { return builder; },
        limit() { return builder; },
        insert(payload) {
          lastWritePayload = payload;
          if (onInsert) onInsert(table, payload);
          return builder;
        },
        update(payload) {
          lastWritePayload = payload;
          if (onUpdate) onUpdate(table, payload);
          return builder;
        },
        delete() { return builder; },
        maybeSingle() { return builder; },
        single() { return builder; },
        then(resolve, reject) {
          const queue = state[table];
          if (!queue || queue.length === 0) {
            resolve({ data: null, error: null, count: 0 });
            return;
          }
          const next = queue.shift();
          resolve(typeof next === 'function' ? next(lastWritePayload) : next);
        },
      };
      return builder;
    },
  };
}
