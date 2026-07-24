// Observability + free-tool rate limiting. Shapes, not payloads — no user
// content is retained beyond the request lifecycle (DESIGN.md §4.5).
// Uses the optional STATS KV binding; everything degrades gracefully without it.

function today() {
  return new Date().toISOString().slice(0, 10);
}

function kv(env) {
  // Binding may be absent (KV namespace not created yet) — tolerate it.
  return env.STATS && typeof env.STATS.get === "function" ? env.STATS : null;
}

/** Increment stats:<date>:<tool>:<status>. Non-atomic, fine for rough counts. */
export async function recordStat(env, toolName, status) {
  const store = kv(env);
  if (!store) return;
  const key = `stats:${today()}:${toolName}:${status}`;
  try {
    const current = parseInt((await store.get(key)) ?? "0", 10);
    await store.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 * 60 });
  } catch (err) {
    console.log(JSON.stringify({ evt: "stat_write_failed", error: String(err).slice(0, 200) }));
  }
}

/** Per-IP daily limit on the free tool. Fails open if KV is unavailable. */
export async function checkRateLimit(request, env) {
  const limit = parseInt(env.FREE_TOOL_DAILY_LIMIT ?? "10", 10);
  const store = kv(env);
  if (!store) return { ok: true, limit };
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:${today()}:${ip}`;
  try {
    const count = parseInt((await store.get(key)) ?? "0", 10);
    if (count >= limit) return { ok: false, limit };
    await store.put(key, String(count + 1), { expirationTtl: 60 * 60 * 48 });
    return { ok: true, limit };
  } catch {
    return { ok: true, limit };
  }
}

/** Private GET /stats?key=<STATS_KEY> — totals per day per tool.
 *  This is the Revenue Rocket evidence for the submission form. */
export async function handleStats(request, env) {
  const url = new URL(request.url);
  const provided = url.searchParams.get("key") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.STATS_KEY || provided !== env.STATS_KEY) {
    return new Response("Not found", { status: 404 });
  }
  const store = kv(env);
  if (!store) {
    return Response.json({ error: "STATS KV namespace not configured" }, { status: 503 });
  }

  const totals = {}; // { date: { tool: { status: n } } }
  let cursor;
  do {
    const page = await store.list({ prefix: "stats:", cursor });
    const values = await Promise.all(page.keys.map((k) => store.get(k.name)));
    page.keys.forEach((k, i) => {
      const [, date, tool, status] = k.name.split(":");
      totals[date] ??= {};
      totals[date][tool] ??= {};
      totals[date][tool][status] = parseInt(values[i] ?? "0", 10);
    });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const grand = {};
  for (const day of Object.values(totals)) {
    for (const [tool, statuses] of Object.entries(day)) {
      grand[tool] ??= {};
      for (const [status, n] of Object.entries(statuses)) {
        grand[tool][status] = (grand[tool][status] ?? 0) + n;
      }
    }
  }
  return Response.json({ generated_at: new Date().toISOString(), per_day: totals, totals: grand });
}
