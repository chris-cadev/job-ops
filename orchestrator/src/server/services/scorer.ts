/**
 * Service for scoring job suitability using AI.
 */

import { logger } from "@infra/logger";
import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import type { Job } from "@shared/types";
import type { JsonSchemaDefinition } from "./llm/types";
import { stripMarkdownCodeFences } from "./llm/utils/json";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import { renderPromptTemplate } from "./prompt-templates";
import { getEffectiveSettings } from "./settings";

export class LlmNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message ?? "LLM API key not configured");
    this.name = "LlmNotConfiguredError";
  }
}

interface SuitabilityResult {
  score: number | null; // 0-100, or null when scoring failed
  reason: string; // Explanation
}

type ScoringPreferences = {
  instructions: string;
  promptTemplate: string;
};

type ProfileRecord = Record<string, unknown>;

/** JSON schema for suitability scoring response */
const SCORING_SCHEMA: JsonSchemaDefinition = {
  name: "job_suitability_score",
  schema: {
    type: "object",
    properties: {
      score: {
        type: "integer",
        description: "Suitability score from 0 to 100",
      },
      reason: {
        type: "string",
        description: "Brief 1-2 sentence explanation of the score",
      },
    },
    required: ["score", "reason"],
    additionalProperties: false,
  },
};

/**
 * Check if a job's salary field is missing/empty.
 * Returns true for null, empty string, or whitespace-only strings.
 */
function isSalaryMissing(salary: string | null): boolean {
  return salary === null || salary.trim() === "";
}

/**
 * Apply salary penalty to a score if enabled.
 * Returns the adjusted score, adjusted reason, and whether penalty was applied.
 */
function applySalaryPenalty(
  job: Job,
  originalScore: number,
  originalReason: string,
  settings: { penalizeMissingSalary: boolean; missingSalaryPenalty: number },
): { score: number; reason: string; penaltyApplied: boolean } {
  if (!settings.penalizeMissingSalary || !isSalaryMissing(job.salary)) {
    return {
      score: originalScore,
      reason: originalReason,
      penaltyApplied: false,
    };
  }

  const penalty = settings.missingSalaryPenalty;
  const adjustedScore = Math.max(0, originalScore - penalty);
  const penaltyText = `Score reduced by ${penalty} points due to missing salary information.`;
  const adjustedReason = `${originalReason} ${penaltyText}`;

  logger.info("Applied salary penalty", {
    jobId: job.id,
    originalScore,
    penalty,
    finalScore: adjustedScore,
  });

  return { score: adjustedScore, reason: adjustedReason, penaltyApplied: true };
}

/**
 * Score a job's suitability based on profile and job description.
 * Includes retry logic for when AI returns garbage responses.
 */
export async function scoreJobSuitability(
  job: Job,
  profile: Record<string, unknown>,
): Promise<SuitabilityResult> {
  const [model, settings] = await Promise.all([
    resolveLlmModel("scoring"),
    getEffectiveSettings(),
  ]);

  const prompt = buildScoringPrompt(job, profile, {
    instructions: settings.scoringInstructions?.value ?? "",
    promptTemplate:
      settings.scoringPromptTemplate?.value ??
      getDefaultPromptTemplate("scoringPromptTemplate"),
  });

  const llm = await createConfiguredLlmService("scoring");
  const result = await llm.callJson<{ score: number; reason: string }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: SCORING_SCHEMA,
    maxRetries: 2,
    jobId: job.id,
  });

  if (!result.success) {
    logger.warn("Scoring failed for job", {
      jobId: job.id,
      error: result.error,
    });
    return { score: null, reason: `Scoring failed: ${result.error}` };
  }

  const { score, reason } = result.data;

  // Validate we got a reasonable response
  if (typeof score !== "number" || Number.isNaN(score)) {
    logger.warn("Invalid score in AI response for job", {
      jobId: job.id,
    });
    return { score: null, reason: "AI returned invalid scoring data" };
  }

  const clampedScore = Math.min(100, Math.max(0, Math.round(score)));
  const clampedReason = reason || "No explanation provided";

  // Apply salary penalty if enabled
  const penaltyResult = applySalaryPenalty(job, clampedScore, clampedReason, {
    penalizeMissingSalary: settings.penalizeMissingSalary.value,
    missingSalaryPenalty: settings.missingSalaryPenalty.value,
  });

  return {
    score: penaltyResult.score,
    reason: penaltyResult.reason,
  };
}

/**
 * Robustly parse JSON from AI-generated content.
 * Handles common AI quirks: markdown fences, extra text, trailing commas, etc.
 *
 * @deprecated Use LlmService with structured outputs instead. Kept for backwards compatibility with tests.
 */
export function parseJsonFromContent(
  content: string,
  jobId?: string,
): { score?: number; reason?: string } {
  const originalContent = content;
  let candidate = content.trim();

  // Step 1: Remove markdown code fences (with or without language specifier)
  candidate = stripMarkdownCodeFences(candidate);

  // Step 2: Try to extract JSON object if there's surrounding text
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidate = jsonMatch[0];
  }

  // Step 3: Try direct parse first
  try {
    return JSON.parse(candidate);
  } catch {
    // Continue with sanitization
  }

  // Step 4: Fix common JSON issues
  let sanitized = candidate;

  // Remove JavaScript-style comments (// and /* */)
  sanitized = sanitized.replace(/\/\/[^\n]*/g, "");
  sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove trailing commas before } or ]
  sanitized = sanitized.replace(/,\s*([\]}])/g, "$1");

  // Fix unquoted keys: word: -> "word":
  // Be more careful - only match at start of object or after comma
  sanitized = sanitized.replace(
    /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    '$1"$2":',
  );

  // Fix single quotes to double quotes
  sanitized = sanitized.replace(/'/g, '"');

  // Remove ALL control characters (including newlines/tabs INSIDE string values which break JSON)
  // First, let's normalize the string - escape actual newlines inside strings
  // biome-ignore lint/suspicious/noControlCharactersInRegex: needed to fix broken JSON from AI
  const controlCharsRegex = /[\x00-\x1F\x7F]/g;
  sanitized = sanitized.replace(controlCharsRegex, (match) => {
    if (match === "\n") return "\\n";
    if (match === "\r") return "\\r";
    if (match === "\t") return "\\t";
    return "";
  });

  // Step 5: Try parsing the sanitized version
  try {
    return JSON.parse(sanitized);
  } catch {
    // Continue with more aggressive extraction
  }

  // Step 6: Even more aggressive - try to rebuild a minimal valid JSON
  // by extracting just the score and reason values
  const scoreMatch = originalContent.match(
    /["']?score["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i,
  );
  const reasonMatch =
    originalContent.match(/["']?reason["']?\s*[:=]\s*["']([^"'\n]+)["']/i) ||
    originalContent.match(
      /["']?reason["']?\s*[:=]\s*["']?(.*?)["']?\s*[,}\n]/is,
    );

  if (scoreMatch) {
    const score = Math.round(parseFloat(scoreMatch[1]));
    const reason = reasonMatch
      ? reasonMatch[1].trim().replace(controlCharsRegex, "")
      : "Score extracted from malformed response";
    logger.warn("Parsed score via regex fallback", {
      jobId: jobId || "unknown",
      score,
    });
    return { score, reason };
  }

  // Log the failure with full content for debugging
  logger.error("Failed to parse AI response", {
    jobId: jobId || "unknown",
    rawSample: originalContent.substring(0, 500),
    sanitizedSample: sanitized.substring(0, 500),
  });

  throw new Error("Unable to parse JSON from model response");
}

// --- Profile condensation for scoring ---

const SCORING_INPUT_CHAR_BUDGET = 16_000;
const MAX_SKILLS = 15;
const MAX_EXPERIENCE = 5;
const MAX_PROJECTS = 4;
const MAX_EDUCATION = 3;
const MAX_ITEM_TEXT = 300;

function buildScoringPrompt(
  job: Job,
  profile: Record<string, unknown>,
  preferences: ScoringPreferences,
): string {
  const profileSnapshot = buildScoringProfileSnapshot(profile);
  const jobDescription = job.jobDescription || "No description available";

  const totalChars = profileSnapshot.length + jobDescription.length;
  const { a: cappedProfile, b: cappedJd } = splitBudget(
    profileSnapshot,
    jobDescription,
    SCORING_INPUT_CHAR_BUDGET,
  );

  if (
    cappedProfile.length < profileSnapshot.length ||
    cappedJd.length < jobDescription.length
  ) {
    logger.info("Scoring prompt inputs truncated to fit context window", {
      jobId: job.id,
      originalChars: totalChars,
      budgetChars: SCORING_INPUT_CHAR_BUDGET,
      profileChars: `${cappedProfile.length}/${profileSnapshot.length}`,
      jdChars: `${cappedJd.length}/${jobDescription.length}`,
    });
  }

  return renderPromptTemplate(preferences.promptTemplate, {
    profileJson: cappedProfile,
    jobTitle: job.title,
    employer: job.employer,
    location: job.location || "Not specified",
    salary: job.salary || "Not specified",
    degreeRequired: job.degreeRequired || "Not specified",
    disciplines: job.disciplines || "Not specified",
    jobDescription: cappedJd,
    scoringInstructionsText: preferences.instructions
      ? preferences.instructions
      : "No additional custom scoring instructions.",
  });
}

/**
 * Build a compact text snapshot of the candidate profile for scoring.
 * Caps item counts and truncates long text to keep the prompt small enough
 * for small-context models (e.g. Gemma 4 2B with 8k context window).
 *
 * Mirrors the approach used in ghostwriter-context.ts buildProfileSnapshot.
 */
function buildScoringProfileSnapshot(profile: Record<string, unknown>): string {
  const parts: string[] = [];

  // --- basics ---
  const basics = isRecord(profile.basics) ? profile.basics : {};
  const headline =
    (typeof basics.headline === "string" && basics.headline) ||
    (typeof basics.label === "string" && basics.label) ||
    "";
  if (headline) parts.push(`Headline: ${scoringTruncate(headline, 200)}`);

  const summary = (typeof basics.summary === "string" && basics.summary) || "";
  if (summary) parts.push(`Summary:\n${scoringTruncate(summary, 600)}`);

  const location =
    (typeof basics.location === "string" && basics.location) || "";
  if (location) parts.push(`Location: ${location}`);

  // --- skills ---
  const skills = collectSectionItems(profile, "skills")
    .filter(isVisibleCvItem)
    .slice(0, MAX_SKILLS)
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : "";
      const kws = Array.isArray(item.keywords)
        ? item.keywords.slice(0, 6).join(", ")
        : "";
      const level = typeof item.level === "string" ? ` (${item.level})` : "";
      return `${name}${level}${kws ? `: ${kws}` : ""}`;
    })
    .filter(Boolean);
  if (skills.length > 0) parts.push(`Skills:\n- ${skills.join("\n- ")}`);

  // --- experience ---
  const experience = collectSectionItems(profile, "experience")
    .filter(isVisibleCvItem)
    .slice(0, MAX_EXPERIENCE)
    .map((item) => {
      const pos = typeof item.position === "string" ? item.position : "";
      const co = typeof item.company === "string" ? item.company : "";
      const date = typeof item.date === "string" ? item.date : "";
      const text =
        (typeof item.summary === "string" && item.summary) ||
        (typeof item.description === "string" && item.description) ||
        "";
      return `${pos}${co ? ` @ ${co}` : ""}${date ? ` (${date})` : ""}: ${scoringTruncate(text, MAX_ITEM_TEXT)}`;
    })
    .filter(Boolean);
  if (experience.length > 0)
    parts.push(`Experience:\n- ${experience.join("\n- ")}`);

  // --- projects ---
  const projects = collectSectionItems(profile, "projects")
    .filter(isVisibleCvItem)
    .slice(0, MAX_PROJECTS)
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : "";
      const date = typeof item.date === "string" ? item.date : "";
      const text =
        (typeof item.summary === "string" && item.summary) ||
        (typeof item.description === "string" && item.description) ||
        "";
      return `${name}${date ? ` (${date})` : ""}: ${scoringTruncate(text, MAX_ITEM_TEXT)}`;
    })
    .filter(Boolean);
  if (projects.length > 0) parts.push(`Projects:\n- ${projects.join("\n- ")}`);

  // --- education ---
  const education = collectSectionItems(profile, "education")
    .filter(isVisibleCvItem)
    .slice(0, MAX_EDUCATION)
    .map((item) => {
      const degree = typeof item.degree === "string" ? item.degree : "";
      const area = typeof item.area === "string" ? item.area : "";
      const school =
        (typeof item.school === "string" && item.school) ||
        (typeof item.institution === "string" && item.institution) ||
        "";
      const date = typeof item.date === "string" ? item.date : "";
      return `${degree}${area ? ` in ${area}` : ""}${school ? ` — ${school}` : ""}${date ? ` (${date})` : ""}`;
    })
    .filter(Boolean);
  if (education.length > 0)
    parts.push(`Education:\n- ${education.join("\n- ")}`);

  // --- certifications ---
  const certs = collectSectionItems(profile, "certifications")
    .filter(isVisibleCvItem)
    .slice(0, 3)
    .map((item) => {
      const title = typeof item.title === "string" ? item.title : "";
      const issuer = typeof item.issuer === "string" ? item.issuer : "";
      return `${title}${issuer ? ` — ${issuer}` : ""}`;
    })
    .filter(Boolean);
  if (certs.length > 0) parts.push(`Certifications:\n- ${certs.join("\n- ")}`);

  // --- languages ---
  const langs = collectSectionItems(profile, "languages")
    .filter(isVisibleCvItem)
    .slice(0, 5)
    .map((item) => {
      const lang = typeof item.language === "string" ? item.language : "";
      const fluency = typeof item.fluency === "string" ? item.fluency : "";
      return `${lang}${fluency ? ` (${fluency})` : ""}`;
    })
    .filter(Boolean);
  if (langs.length > 0) parts.push(`Languages: ${langs.join(", ")}`);

  return parts.join("\n\n");
}

// --- Shared helpers ---

function scoringTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function collectSectionItems(
  profile: Record<string, unknown>,
  sectionKey: string,
): ProfileRecord[] {
  const sections = isRecord(profile.sections) ? profile.sections : {};
  const section = sections[sectionKey];

  if (isRecord(section)) {
    if (!isVisibleCvItem(section)) return [];
    if (Array.isArray(section.items)) {
      return section.items.filter(isRecord);
    }
  }

  const topLevelSection = profile[sectionKey];
  if (Array.isArray(topLevelSection)) return topLevelSection.filter(isRecord);
  if (isRecord(topLevelSection)) {
    if (!isVisibleCvItem(topLevelSection)) return [];
    if (Array.isArray(topLevelSection.items)) {
      return topLevelSection.items.filter(isRecord);
    }
  }

  return [];
}

function isVisibleCvItem(item: ProfileRecord): boolean {
  if (item.hidden === true) return false;
  if (item.visible === false) return false;
  return true;
}

function isRecord(value: unknown): value is ProfileRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Split a character budget between two strings, truncating the longer one first.
 * Returns both strings capped so their combined length ≤ budget.
 */
function splitBudget(
  a: string,
  b: string,
  budget: number,
): { a: string; b: string } {
  const total = a.length + b.length;
  if (total <= budget) return { a, b };

  const ratio = a.length / total;
  const budgetA = Math.floor(budget * ratio);
  const budgetB = budget - budgetA;

  return {
    a: scoringTruncate(a, budgetA),
    b: scoringTruncate(b, budgetB),
  };
}

/**
 * Score multiple jobs and return sorted by score (descending).
 */
export async function scoreAndRankJobs(
  jobs: Job[],
  profile: Record<string, unknown>,
): Promise<
  Array<Job & { suitabilityScore: number | null; suitabilityReason: string }>
> {
  const scoredJobs = await Promise.all(
    jobs.map(async (job) => {
      const { score, reason } = await scoreJobSuitability(job, profile);
      return {
        ...job,
        suitabilityScore: score,
        suitabilityReason: reason,
      };
    }),
  );

  return scoredJobs.sort((a, b) => {
    if (a.suitabilityScore == null && b.suitabilityScore == null) return 0;
    if (a.suitabilityScore == null) return 1;
    if (b.suitabilityScore == null) return -1;
    return b.suitabilityScore - a.suitabilityScore;
  });
}
