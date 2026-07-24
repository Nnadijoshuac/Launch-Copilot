// The product surface: exactly three MCP tools (DESIGN.md §3).
// Tool names are verbs; every parameter description is written for an agent
// reader — descriptions are the ad copy that routing agents read.

import rules from "./knowledge/rules.json";
import comps from "./knowledge/comps.json";
import { generateValidated } from "./engine.js";
import { preflight } from "./preflight.js";
import { validateAudit, validateLaunchKit, validatePricingCheck, validatePreflight } from "./validators.js";

const CATEGORY_MAP = {
  finance: "Finance",
  software: "Software services",
  lifestyle: "Lifestyle",
  art: "Art creation",
  other: "Others",
};
const CATEGORIES = Object.keys(CATEGORY_MAP);
const SERVICE_TYPES = ["a2mcp", "a2a"];

const SYSTEM = `You are Launch Copilot, an expert advisor on the OKX.AI agent marketplace, operating as an A2MCP service. Your callers are usually AI agents acting on behalf of ASP builders in the OKX.AI Genesis Hackathon (deadline ${rules.hackathon.deadline_utc}).

Hard output rules:
- Output exactly ONE markdown document. No preamble, no closing remarks, no code fences wrapping the document.
- Use the exact section headings specified in the task, in the exact order. Never leave a section empty or write placeholder text.
- Every section must be paste-ready: concrete copy the builder can ship as-is, never advice about what copy "could" say.
- Ground every claim about the marketplace in the knowledge below. When referencing comps, cite the snapshot date (${comps.snapshot_date}).

OKX.AI platform knowledge (curated, authoritative for this task):
${JSON.stringify(rules)}

Marketplace comps snapshot (live okx.ai/agents data, ${comps.snapshot_date}):
${JSON.stringify(comps)}`;

function fmt(v, fallback = "not provided") {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

export const TOOLS = [
  {
    name: "preflight_x402",
    priceAtomic: null, // FREE — top of funnel
    priceLabel: "FREE",
    description:
      "FREE. Pre-flight your ASP endpoint against the exact x402 payment-flow checks OKX's reviewer runs, BEFORE you submit for listing. " +
      "Probes your live endpoint (no payment is signed, no keys are handled) and returns a plain-language pass/fail report: " +
      "which rejection reasons you will hit, the evidence we saw, and the exact fix for each. " +
      "Catches the common killers: blocked hosting domain, no HTTP 402 on unpaid requests, empty accepts[], wrong token or network, " +
      "price mismatch with your registered fee, zero-fee trap, MCP servers that 406 without text/event-stream, x402 v1/v2 mismatch, " +
      "and paid-path failures (re-challenging after payment, or returning an empty/pending stub instead of the deliverable). " +
      "Run this before every submission and after every fix.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description:
            'Your ASP\'s registered x402 endpoint URL, including https://. Example: "https://myagent.example.com/mcp"',
        },
        expected_fee_usdt: {
          type: "number",
          description:
            "Optional but recommended: the per-call fee you registered on your listing, in USDT. Example: 1. Lets us verify your 402 charges exactly what you advertised.",
        },
        is_mcp: {
          type: "boolean",
          description:
            "Optional, default true. true = an A2MCP Streamable-HTTP MCP server; false = a plain REST x402 endpoint. Controls the MCP-specific Accept-header check.",
        },
        business_body: {
          type: "object",
          description:
            'Optional: a sample valid request body your paid tool expects, so we can probe the real paid path shape. Example: {"category":"finance"}',
        },
      },
      required: ["endpoint"],
    },
    example: {
      endpoint: "https://myagent.example.com/mcp",
      expected_fee_usdt: 1,
      is_mcp: true,
    },
    sections: ["Preflight Verdict", "Blocking Issues", "Warnings", "Passed", "Before you submit"],
    validate: validatePreflight,
    // Custom runner: probes + rules engine, no LLM call (deterministic, free, fast).
    run: async (_env, args) => {
      const { text } = await preflight(args);
      return { text, warnings: [], provider: "probe" };
    },
  },
  {
    name: "audit_listing",
    priceAtomic: null, // FREE — the funnel
    priceLabel: "FREE",
    description:
      "FREE. Audit a draft OKX.AI marketplace listing before submitting it for review. " +
      "Returns a markdown report with: a readiness score (0-100) against OKX review expectations, " +
      "a PASS-LIKELY/AT-RISK verdict, the top 3 concrete fixes ranked by impact (with rewritten paste-ready text), " +
      "and a comparison to a top performer in your category. " +
      "Call this before listing any ASP on OKX.AI. For the complete launch package (optimized listing, pricing, " +
      "X thread, demo script) use generate_launch_kit.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'The ASP name as it will appear on OKX.AI. Example: "PixelBrief"',
        },
        description: {
          type: "string",
          description:
            "Your draft listing description, pasted verbatim (the text buyers and routing agents will read). 20-4000 characters.",
        },
        category: {
          type: "string",
          enum: CATEGORIES,
          description:
            'OKX.AI marketplace category. One of: finance, software, lifestyle, art, other. Example: "software"',
        },
        price_per_call: {
          type: "number",
          description: "Optional planned price per call in USDT. Example: 0.5. Omit if undecided.",
        },
        service_type: {
          type: "string",
          enum: SERVICE_TYPES,
          description:
            'OKX.AI service type: "a2mcp" (standardized pay-per-call MCP/API service) or "a2a" (negotiated jobs). Most tool-like services are "a2mcp".',
        },
      },
      required: ["name", "description", "category", "service_type"],
    },
    example: {
      name: "ChainWatch",
      description: "ChainWatch monitors wallets across 20 chains and alerts your agent when balances move.",
      category: "software",
      price_per_call: 0.1,
      service_type: "a2mcp",
    },
    maxTokens: 3500,
    sections: ["Readiness Score", "Top 3 Fixes", "Comparison", "Next Step"],
    validate: validateAudit,
    buildPrompt(a) {
      return `Task: audit_listing — score this draft OKX.AI listing and return the highest-impact fixes.

Builder's draft listing:
- name: ${a.name}
- category: ${a.category} (marketplace category: "${CATEGORY_MAP[a.category]}")
- service_type: ${a.service_type}
- price_per_call: ${fmt(a.price_per_call, "not decided yet")}
- description (verbatim):
"""
${a.description}
"""

Produce EXACTLY this structure:

## Readiness Score
First line exactly: \`Score: NN/100 — VERDICT\` where NN is 0-100 and VERDICT is PASS-LIKELY or AT-RISK (against OKX's 24h review and listing norms). Then 2-3 sentences justifying the score against the listing best practices and review expectations in your knowledge.

## Top 3 Fixes
A numbered list of exactly 3 fixes, ranked by impact. Each fix states what to change and, where the fix is copy, includes the rewritten paste-ready replacement text.

## Comparison
One sharp comparison with a top performer in the "${CATEGORY_MAP[a.category]}" category from the comps snapshot (cite the snapshot date). Name one concrete, measurable difference between their listing approach and this draft.

## Next Step
Exactly one sentence pointing the builder at generate_launch_kit (1 USDT) for the complete package: optimized listing, pricing recommendation, X launch thread, and 90-second demo script. Nothing else in this section.`;
    },
  },

  {
    name: "generate_launch_kit",
    priceAtomic: "1000000", // 1 USDT (6 decimals)
    priceLabel: "1 USDT per call (x402)",
    description:
      "1 USDT per call (x402, USDT on X Layer). The complete OKX.AI launch package as one paste-ready markdown document: " +
      "3 name options with rationale, an optimized listing description (hook first line, written for humans AND routing agents), " +
      "a service list in OKX's register format, a specific pricing recommendation benchmarked against live marketplace comps, " +
      "a 4-6 post X launch thread including #OKXAI (hackathon Step 3 compliant), and a timed 90-second demo script (max 220 words). " +
      "Everything the OKX.AI Genesis Hackathon requires of a launch, from one call.",
    inputSchema: {
      type: "object",
      properties: {
        what_it_does: {
          type: "string",
          description:
            'Plain-text description of what your agent/service does — capabilities, inputs, outputs. The more concrete, the better the kit. Example: "Monitors any wallet across 20 chains and pushes alerts to the caller\'s agent when balances move more than a threshold."',
        },
        category: {
          type: "string",
          enum: CATEGORIES,
          description: 'OKX.AI marketplace category. Example: "software"',
        },
        target_user: {
          type: "string",
          description: 'Who calls your service. Example: "trading agents that need wallet movement signals"',
        },
        service_type: {
          type: "string",
          enum: SERVICE_TYPES,
          description: 'OKX.AI service type: "a2mcp" or "a2a".',
        },
        draft_name: {
          type: "string",
          description: "Optional: your working name, to improve or endorse.",
        },
        draft_description: {
          type: "string",
          description: "Optional: your draft listing description, to rewrite rather than start from scratch.",
        },
      },
      required: ["what_it_does", "category", "target_user", "service_type"],
    },
    example: {
      what_it_does: "Monitors any wallet across 20 chains and alerts the caller's agent when balances move.",
      category: "software",
      target_user: "trading agents that need wallet movement signals",
      service_type: "a2mcp",
      draft_name: "ChainWatch",
    },
    maxTokens: 4500,
    sections: ["Listing Package", "Pricing Recommendation", "X Launch Thread", "Demo Script (90 seconds)"],
    validate: validateLaunchKit,
    buildPrompt(a) {
      return `Task: generate_launch_kit — produce the complete, paste-ready OKX.AI launch package.

Builder input:
- what_it_does: ${a.what_it_does}
- category: ${a.category} (marketplace category: "${CATEGORY_MAP[a.category]}")
- target_user: ${a.target_user}
- service_type: ${a.service_type}
- draft_name: ${fmt(a.draft_name, "none — propose from scratch")}
- draft_description: ${fmt(a.draft_description, "none — write from scratch")}

Produce EXACTLY this structure:

## Listing Package
### Name Options
3 name options, each with a one-line rationale. If a draft_name was given, either improve it or endorse it as option 1 with reasoning.
### Description
The paste-ready listing description. Requirements: the deliverable stated in the first 8 words; written for two readers at once (a human browsing and a routing agent deciding whether to call); concrete nouns over adjectives; states exact prices per service; names the response format; ends with 2-3 example prompts a user could try.
### Service List
Each service on its own line: a verb-phrase service name (e.g. audit_listing, generate_report), a one-line description of what the caller gets, and its price in USDT (or FREE).

## Pricing Recommendation
A specific per-call price with reasoning benchmarked against the comps snapshot (cite the snapshot date and at least 2 named comps, plus the relevant pricing band). Include a one-sentence free-tier recommendation.

## X Launch Thread
A numbered thread of 4-6 posts, each 280 characters or less. Post 1: hook. Middle posts: the problem, then a concrete demo walkthrough. Final post: try-it call to action naming OKX.AI and the price. The thread MUST include the hashtag #OKXAI at least once (hackathon requirement).

## Demo Script (90 seconds)
A timed beat sheet for a screen-recorded demo:
- \`0:00-0:15\` — the hook: the problem in one line
- \`0:15-0:60\` — the walkthrough: show the real product doing the real thing, step by step
- \`0:60-0:90\` — the result + call to action: where to find it on OKX.AI, the price, and #OKXAI
HARD LIMIT: at most 200 words total in this section (spoken at ~150 wpm it must fit 90 seconds).`;
    },
  },

  {
    name: "pricing_check",
    priceAtomic: "200000", // 0.2 USDT
    priceLabel: "0.2 USDT per call (x402)",
    description:
      "0.2 USDT per call (x402, USDT on X Layer). Fast pricing sanity-check for an OKX.AI service: " +
      "a markdown comps table for your category (top agents, prices, sold counts, ratings from a curated daily snapshot), " +
      "a specific recommended price per call with rationale, and a free-tier strategy note. " +
      "The cheap way to avoid mispricing your ASP before launch; for the full launch package use generate_launch_kit.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: CATEGORIES,
          description: 'OKX.AI marketplace category. Example: "finance"',
        },
        service_description: {
          type: "string",
          description:
            'One line describing the service you are pricing. Example: "structured crypto derivatives data API, per-call"',
        },
      },
      required: ["category", "service_description"],
    },
    example: {
      category: "finance",
      service_description: "structured crypto derivatives data API, per-call",
    },
    maxTokens: 3500,
    sections: [`Comps (as of ${comps.snapshot_date})`, "Recommended Price", "Free-Tier Strategy"],
    validate: (md) => validatePricingCheck(md, comps.snapshot_date),
    buildPrompt(a) {
      return `Task: pricing_check — recommend a per-call price for this service on OKX.AI.

Input:
- category: ${a.category} (marketplace category: "${CATEGORY_MAP[a.category]}")
- service_description: ${a.service_description}

Produce EXACTLY this structure:

## Comps (as of ${comps.snapshot_date})
A markdown table of the most relevant agents for this category from the comps snapshot, with columns: Name | Positioning | Price (USDT) | Sold | Rating. Include agents from other categories only if directly comparable to the described service. After the table, 1-2 sentences on the pricing pattern that matters for this service.

## Recommended Price
First line exactly: \`Recommended: N USDT per call\` (N may be a decimal). Then one paragraph of rationale citing at least two named comps and the relevant pricing band from the knowledge.

## Free-Tier Strategy
2-4 sentences: whether this service should offer a free tier or free tool, what it should be, and why (sold-count and rating dynamics on OKX.AI).`;
    },
  },
];

export function findTool(name) {
  return TOOLS.find((t) => t.name === name);
}

/** Pure-code input validation. Returns array of agent-correctable error strings. */
export function validateInput(tool, args) {
  const errors = [];
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return [`arguments must be a JSON object`];
  }
  const props = tool.inputSchema.properties;
  for (const req of tool.inputSchema.required) {
    if (args[req] === undefined || args[req] === null || args[req] === "") {
      errors.push(`"${req}" is required — ${props[req].description}`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = props[key];
    if (!spec) {
      errors.push(`unknown argument "${key}" — allowed: ${Object.keys(props).join(", ")}`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (spec.type === "string" && typeof value !== "string") {
      errors.push(`"${key}" must be a string`);
    } else if (spec.type === "number" && typeof value !== "number") {
      errors.push(`"${key}" must be a number (e.g. 0.5), not a string`);
    } else if (spec.type === "boolean" && typeof value !== "boolean") {
      errors.push(`"${key}" must be a boolean (true or false), not a string`);
    } else if (spec.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
      errors.push(`"${key}" must be a JSON object, e.g. {"category":"finance"}`);
    } else if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`"${key}" must be one of: ${spec.enum.join(", ")} (got ${JSON.stringify(value)})`);
    }
  }
  if (typeof args.description === "string" && args.description.length > 4000) {
    errors.push(`"description" is too long (${args.description.length} chars, max 4000)`);
  }
  return errors;
}

// Hard output contract appended per tool — the section list mirrors exactly
// what src/validators.js checks. Written for smaller instruction-following
// models: no room for interpretation.
function systemFor(tool) {
  return (
    SYSTEM +
    `\n\nHARD OUTPUT CONTRACT for this call:
Output ONLY the following markdown sections, in this exact order, each starting with '## <name>':
${tool.sections.map((s) => `## ${s}`).join("\n")}
No prose, titles, or headings before the first '##' line. No text after the last section. Subsections using '###' are allowed only inside a section where the task explicitly asks for them. Never rename, reorder, skip, or add top-level '##' sections.`
  );
}

export async function runTool(env, tool, args) {
  // Tools with their own runner (e.g. the pure-probe preflight checker) skip the
  // LLM path entirely. Output still goes through the same validators.
  if (typeof tool.run === "function") {
    const result = await tool.run(env, args);
    const issues = tool.validate(result.text);
    return { ...result, warnings: issues };
  }
  return generateValidated(env, {
    system: systemFor(tool),
    prompt: tool.buildPrompt(args),
    maxTokens: tool.maxTokens,
    validate: tool.validate,
  });
}
