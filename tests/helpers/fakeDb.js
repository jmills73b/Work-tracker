// A stand-in for env.DB. It does not parse SQL: each answer is declared as
// [substring of the query, value or (params) => value], and the first match wins.
// Keep it dumb; a fake clever enough to run SQL is clever enough to be wrong.
//
// Two details are load-bearing:
// - bind() returns a NEW statement each call, as D1 does, so the calls log can tell
//   "which rows were written" apart from "how many times".
// - first() returns null, not undefined, when nothing matches, because handlers branch on it.

function answer(table, sql, params) {
  for (const [needle, value] of table) {
    if (sql.includes(needle)) return typeof value === 'function' ? value(params) : value;
  }
  return undefined;
}

export function fakeDb({ first = [], all = [], run = [], batch } = {}) {
  const calls = [];

  function statement(sql, params = []) {
    return {
      sql,
      params,
      bind: (...p) => {
        // Real D1 refuses undefined (D1_TYPE_ERROR); a missing argument must fail here too.
        if (p.some((v) => v === undefined)) throw new TypeError(`D1_TYPE_ERROR: undefined bound in: ${sql}`);
        return statement(sql, p);
      },
      async first() {
        calls.push({ method: 'first', sql, params });
        return answer(first, sql, params) ?? null;
      },
      async all() {
        calls.push({ method: 'all', sql, params });
        return { results: answer(all, sql, params) ?? [] };
      },
      async run() {
        calls.push({ method: 'run', sql, params });
        return answer(run, sql, params) ?? { meta: { changes: 1 } };
      },
    };
  }

  return {
    calls,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      calls.push({ method: 'batch', statements: stmts.map((s) => ({ sql: s.sql, params: s.params })) });
      return batch ? batch(stmts) : stmts.map(() => ({ meta: { changes: 1 }, results: [] }));
    },
    // Every SQL string this test ran, batched or not, in order.
    sqlRun() {
      return calls.flatMap((c) => (c.method === 'batch' ? c.statements.map((s) => s.sql) : [c.sql]));
    },
  };
}

// A JSON POST as the browser would send it.
export function jsonRequest(path, body, { method = 'POST', headers = {} } = {}) {
  return new Request(`https://tracker.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
