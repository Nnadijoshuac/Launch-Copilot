// Post-generation validators — pure code, no LLM (DESIGN.md §4.3).

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the body of a `## Heading...` section (prefix-tolerant: the model
 *  may append e.g. "(as of 2026-07-21)"). Returns null if heading missing. */
export function extractSection(md, headingPrefix) {
  // JS has no \Z, so match "until next ## heading" or "until end of string".
  const re = new RegExp(
    `^##\\s+${escapeRe(headingPrefix)}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s)|^##\\s+${escapeRe(headingPrefix)}[^\\n]*\\n([\\s\\S]*)$`,
    "m"
  );
  const m = md.match(re);
  if (!m) return null;
  return (m[1] ?? m[2] ?? "").trim();
}

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function checkSections(md, headings) {
  const issues = [];
  for (const h of headings) {
    const body = extractSection(md, h);
    if (body === null) issues.push(`missing required section "## ${h}"`);
    else if (body.length < 15) issues.push(`section "## ${h}" is empty or near-empty`);
  }
  return issues;
}

export function validateAudit(md) {
  const issues = checkSections(md, ["Readiness Score", "Top 3 Fixes", "Comparison", "Next Step"]);
  if (!/Score:\s*\d{1,3}\s*\/\s*100/.test(md)) {
    issues.push('missing score line in the form "Score: NN/100"');
  }
  return issues;
}

export function validateLaunchKit(md) {
  const issues = checkSections(md, [
    "Listing Package",
    "Pricing Recommendation",
    "X Launch Thread",
    "Demo Script",
  ]);
  const thread = extractSection(md, "X Launch Thread");
  if (thread !== null && !thread.includes("#OKXAI")) {
    issues.push("the X Launch Thread section must include the hashtag #OKXAI");
  }
  const demo = extractSection(md, "Demo Script");
  if (demo !== null) {
    const words = countWords(demo);
    if (words > 220) issues.push(`Demo Script is ${words} words; hard limit is 220 (aim for 200)`);
  }
  return issues;
}

export function validatePreflight(md) {
  const issues = checkSections(md, ["Preflight Verdict", "Blocking Issues", "Warnings", "Passed", "Before you submit"]);
  if (!/\*\*(READY TO SUBMIT|WILL BE REJECTED|RISKY)\*\*/.test(md)) {
    issues.push('missing verdict line (must contain **READY TO SUBMIT**, **WILL BE REJECTED**, or **RISKY**)');
  }
  // Every blocking issue must carry an actionable fix.
  const blocking = extractSection(md, "Blocking Issues") ?? "";
  if (!/^None\.$/m.test(blocking.trim())) {
    const whatCount = (blocking.match(/- What we saw:/g) ?? []).length;
    const fixCount = (blocking.match(/- Fix:/g) ?? []).length;
    if (whatCount !== fixCount || fixCount === 0) {
      issues.push(`every blocking issue needs a "- Fix:" line (${whatCount} issues, ${fixCount} fixes)`);
    }
  }
  return issues;
}

export function validatePricingCheck(md, snapshotDate) {
  const issues = checkSections(md, ["Comps", "Recommended Price", "Free-Tier Strategy"]);
  if (!/Recommended:\s*[\d.]+\s*USDT/.test(md)) {
    issues.push('missing recommendation line in the form "Recommended: N USDT per call"');
  }
  if (snapshotDate && !md.includes(snapshotDate)) {
    issues.push(`must cite the comps snapshot date (${snapshotDate})`);
  }
  return issues;
}
