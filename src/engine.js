// Generation engine — one single-shot LLM call per tool invocation, with
// pure-code validators and exactly one validator retry.
// OpenAI-compatible chat-completions client via raw fetch: zero runtime
// dependencies (CLAUDE.md hard rule). Primary + optional fallback provider.

const TIMEOUT_MS = 30_000;

class ProviderError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chatCompletion(provider, { system, prompt, maxTokens }) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // AbortError (30s timeout) or network failure — retryable.
    throw new ProviderError(`network/timeout: ${String(err).slice(0, 200)}`, true);
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new ProviderError(`HTTP ${res.status}: ${body}`, res.status === 429 || res.status >= 500);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (!text.trim()) throw new ProviderError("empty completion", true);
  return {
    text,
    stopReason: choice?.finish_reason === "length" ? "max_tokens" : "stop",
    ms: Date.now() - started,
  };
}

async function attempt(provider, opts) {
  try {
    const r = await chatCompletion(provider, opts);
    // Shape-only log: which provider/model served the call, never payloads.
    console.log(JSON.stringify({ evt: "llm", provider: provider.name, model: provider.model, ms: r.ms }));
    return { ...r, provider: provider.name };
  } catch (err) {
    console.log(
      JSON.stringify({
        evt: "llm_error",
        provider: provider.name,
        model: provider.model,
        retryable: err.retryable === true,
        error: String(err.message).slice(0, 200),
      })
    );
    throw err;
  }
}

/**
 * Call the configured LLM. Resilience ladder:
 *   primary → (on 429/5xx/timeout: wait 2s, retry primary once) → fallback once.
 * Non-retryable primary errors (400/401/...) skip the pointless retry and go
 * straight to the fallback when one is configured (deviation from the strict
 * retry spec — approved 2026-07-22, see BUILD_NOTES.md §3.4).
 */
export async function callLLM(env, opts) {
  const primary = {
    name: "primary",
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
  };
  if (!primary.baseUrl || !primary.apiKey || !primary.model) {
    throw new Error(
      "LLM provider not configured — set LLM_BASE_URL / LLM_MODEL (wrangler.jsonc vars) and LLM_API_KEY (wrangler secret put LLM_API_KEY)"
    );
  }
  const fallback =
    env.LLM_FALLBACK_BASE_URL && env.LLM_FALLBACK_API_KEY && env.LLM_FALLBACK_MODEL
      ? {
          name: "fallback",
          baseUrl: env.LLM_FALLBACK_BASE_URL,
          apiKey: env.LLM_FALLBACK_API_KEY,
          model: env.LLM_FALLBACK_MODEL,
        }
      : null;

  let lastErr;
  try {
    return await attempt(primary, opts);
  } catch (err) {
    lastErr = err;
  }

  if (lastErr.retryable === true) {
    await sleep(2000);
    try {
      return await attempt(primary, opts);
    } catch (err) {
      lastErr = err;
    }
  }

  if (fallback) {
    try {
      return await attempt(fallback, opts);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr;
}

/**
 * Generate + validate, with one retry that feeds the failure reasons back.
 * `validate(text)` returns an array of issue strings (empty = pass).
 * Returns { text, warnings, provider } — warnings non-empty means graceful
 * partial result. Model-agnostic: validators only ever see the output text.
 */
export async function generateValidated(env, { system, prompt, maxTokens, validate }) {
  const first = await callLLM(env, { system, prompt, maxTokens });
  let issues =
    first.stopReason === "max_tokens"
      ? ["output was truncated before completion"]
      : validate(first.text);
  if (issues.length === 0) return { text: first.text, warnings: [], provider: first.provider };

  const retryPrompt =
    prompt +
    `\n\nIMPORTANT: your previous attempt failed these automated checks:\n- ` +
    issues.join("\n- ") +
    `\nRegenerate the COMPLETE document from the top, fixing every listed issue. Keep the exact required section structure.`;

  const second = await callLLM(env, { system, prompt: retryPrompt, maxTokens });
  const secondIssues =
    second.stopReason === "max_tokens"
      ? ["output was truncated before completion"]
      : validate(second.text);
  if (secondIssues.length === 0) return { text: second.text, warnings: [], provider: second.provider };

  // Graceful partial result: return whichever attempt failed fewer checks.
  return secondIssues.length <= issues.length
    ? { text: second.text, warnings: secondIssues, provider: second.provider }
    : { text: first.text, warnings: issues, provider: first.provider };
}
