import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type { Job } from "@shared/types";
import { uploadJobPdf } from "./job-pdf-upload";

export const CV_TAILORING_NOTE_TITLE = "Tailored CVs (cv-tailoring)";
const MAX_NOTE_CONTENT = 20000;
const INGEST_TIMEOUT_MS = 300_000;
const EXPORT_TIMEOUT_MS = 120_000;

export type CvTailoringConfig = {
  repoPath: string;
  concurrency: number;
  timeoutSec: number;
  pythonBin: string;
};

export type CvTailoringJobResult = {
  jobId: string;
  success: boolean;
  skipped?: boolean;
  docUrl?: string;
  error?: string;
};

async function readBooleanSetting(
  key: "cvTailoringEnabled",
): Promise<boolean | null> {
  const raw = await settingsRepo.getSetting(key);
  if (raw === null) return null;
  return (
    settingsRegistry[key].parse(raw ?? undefined) ??
    settingsRegistry[key].default()
  );
}

async function readIntSetting(
  key: "cvTailoringConcurrency" | "cvTailoringTimeoutSec",
  fallback: number,
): Promise<number> {
  try {
    const raw = await settingsRepo.getSetting(key);
    if (raw === null) return fallback;
    return (
      settingsRegistry[key].parse(raw ?? undefined) ??
      settingsRegistry[key].default()
    );
  } catch {
    return fallback;
  }
}

/** Merged enable flag: per-run override wins, then settings, default off. */
export async function resolveCvTailoringEnabled(
  override?: boolean,
): Promise<boolean> {
  if (override !== undefined) return override;
  return (await readBooleanSetting("cvTailoringEnabled")) ?? false;
}

/**
 * Anti-corruption layer config. Returns null when the phase must be skipped:
 * disabled is handled by the caller; null means "enabled but unusable"
 * (no repo path configured or repo scripts missing). Never throws.
 */
export async function resolveCvTailoringConfig(
  override?: boolean,
): Promise<CvTailoringConfig | null> {
  try {
    if (!(await resolveCvTailoringEnabled(override))) return null;
    const repoPath =
      process.env.CV_TAILORING_REPO_PATH?.trim() ||
      (await settingsRepo.getSetting("cvTailoringRepoPath"))?.trim() ||
      "";
    if (!repoPath) {
      logger.warn(
        "CV tailoring enabled but no repo path configured (CV_TAILORING_REPO_PATH)",
      );
      return null;
    }
    for (const script of [
      "ingest-jd.py",
      "generate-cv.py",
      "gdocs_publish.py",
    ]) {
      try {
        await access(join(repoPath, "_shared", script));
      } catch {
        logger.warn("CV tailoring repo missing script, skipping phase", {
          script,
          repoPath,
        });
        return null;
      }
    }
    const concurrency = Math.max(
      1,
      Math.min(10, (await readIntSetting("cvTailoringConcurrency", 2)) || 2),
    );
    const timeoutSec = Math.max(
      60,
      Math.min(
        3600,
        (await readIntSetting("cvTailoringTimeoutSec", 420)) || 420,
      ),
    );
    return {
      repoPath,
      concurrency,
      timeoutSec,
      pythonBin:
        process.env.CV_TAILORING_PYTHON?.trim() ||
        (process.platform === "win32" ? "python" : "python3"),
    };
  } catch (error) {
    logger.warn("Failed to resolve CV tailoring config, skipping phase", {
      error,
    });
    return null;
  }
}

// --- Filename/slug mapping (mirrors _shared/{ingest-jd,lib}.py) ---

function cleanFilePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value: string, maxLen = 40): string {
  const slug = value
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug;
}

export function buildJdFileName(job: Pick<Job, "title" | "employer">): string {
  const role = cleanFilePart(job.title) || "role";
  const company = cleanFilePart(job.employer) || "company";
  return `JD - ${role} - ${company}.md`;
}

export function buildCvSlug(job: Pick<Job, "title" | "employer">): string {
  return `${slugify(job.title)}--${slugify(job.employer)}`;
}

// --- Stdout parsers (pure; the ACL boundary with the scripts) ---

/** `WROTE: <ats path> (<n> chars)` from generate-cv.py. */
export function parseWroteLine(stdout: string): string | null {
  const match = stdout.match(/^WROTE:\s*(.+?\.md)\s*\(/m);
  return match?.[1]?.trim() ?? null;
}

/** `publish complete: roles=N url=<doc url> ...` from gdocs_publish.py. */
export function parsePublishUrl(stdout: string): string | null {
  const match = stdout.match(
    /url=(https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit)/,
  );
  return match?.[1] ?? null;
}

export function parseDocId(docUrl: string): string | null {
  const match = docUrl.match(/\/document\/d\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function cvLineKey(job: Pick<Job, "title" | "employer">): string {
  return `${job.employer} — ${job.title}`;
}

function buildCvLine(
  job: Pick<Job, "title" | "employer">,
  docUrl: string,
): string {
  return `- [${cvLineKey(job)}](${docUrl}) — ${new Date().toISOString().slice(0, 10)}`;
}

async function runPython(args: {
  repoPath: string;
  scriptArgs: string[];
  timeoutMs: number;
  jobId: string;
  label: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const pythonBin =
    process.env.CV_TAILORING_PYTHON?.trim() ||
    (process.platform === "win32" ? "python" : "python3");
  return new Promise((resolve) => {
    const child = spawn(pythonBin, args.scriptArgs, {
      cwd: args.repoPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      logger.warn("CV tailoring script timed out", {
        jobId: args.jobId,
        label: args.label,
        timeoutMs: args.timeoutMs,
      });
      done(124);
    }, args.timeoutMs);
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += `\nspawn error: ${error instanceof Error ? error.message : String(error)}`;
      done(127);
    });
    child.on("close", (code) => done(code ?? 1));
  });
}

const EXPORT_SNIPPET = `
import importlib.util, os, sys
repo, doc_id = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("gp", os.path.join(repo, "_shared", "gdocs_publish.py"))
gp = importlib.util.module_from_spec(spec); spec.loader.exec_module(gp)
cfg = gp.load_config()
_, drive = gp.build_clients(cfg)
sys.stdout.buffer.write(drive.files().export(fileId=doc_id, mimeType="application/pdf").execute())
`.trim();

/**
 * Per-job saga: ingest → generate+publish → note upsert → PDF export+upload.
 * Idempotent receiver: re-runs skip regeneration when the Doc URL is already
 * in the job note (unless force). Never throws; failures keep prior note/PDF.
 */
export async function runCvTailoringForJob(
  jobId: string,
  config: CvTailoringConfig,
  options: { force?: boolean } = {},
): Promise<CvTailoringJobResult> {
  const fail = (error: string): CvTailoringJobResult => {
    logger.warn("CV tailoring failed for job", { jobId, error });
    return { jobId, success: false, error };
  };
  let workDir: string | null = null;
  try {
    const job = await jobsRepo.getJobById(jobId);
    if (!job) return fail("Job not found");
    if (!job.jobDescription?.trim())
      return {
        jobId,
        success: false,
        skipped: true,
        error: "No job description",
      };

    const notes = await jobsRepo.listJobNotes(jobId);
    const existing = notes.find((n) => n.title === CV_TAILORING_NOTE_TITLE);
    const key = cvLineKey(job);
    const existingUrl = existing
      ? (existing.content
          .split("\n")
          .find((line) => line.includes(key))
          ?.match(
            /https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit/,
          )?.[0] ?? null)
      : null;

    let docUrl = options.force ? null : existingUrl;
    if (!docUrl) {
      workDir = await mkdtemp(join(tmpdir(), "cv-tailor-"));
      const jdFile = join(workDir, buildJdFileName(job));
      await writeFile(jdFile, job.jobDescription, "utf-8");

      const ingest = await runPython({
        repoPath: config.repoPath,
        scriptArgs: [join(config.repoPath, "_shared", "ingest-jd.py"), jdFile],
        timeoutMs: INGEST_TIMEOUT_MS,
        jobId,
        label: "ingest-jd",
      });
      if (ingest.exitCode !== 0) {
        return fail(
          `ingest-jd failed (exit ${ingest.exitCode}): ${ingest.stderr.slice(-500)}`,
        );
      }
      const slug = buildCvSlug(job);
      const analysisFile = join(
        config.repoPath,
        "software-engineer",
        "04-target-role-analysis",
        `${slug}.md`,
      );
      const generate = await runPython({
        repoPath: config.repoPath,
        scriptArgs: [
          join(config.repoPath, "_shared", "generate-cv.py"),
          analysisFile,
          "--no-questions",
          "--timeout",
          String(config.timeoutSec),
        ],
        timeoutMs: config.timeoutSec * 3 * 1000 + 60_000,
        jobId,
        label: "generate-cv",
      });
      if (generate.exitCode !== 0) {
        return fail(
          `generate-cv failed (exit ${generate.exitCode}): ${(generate.stderr || generate.stdout).slice(-500)}`,
        );
      }
      docUrl = parsePublishUrl(generate.stdout);
      if (!docUrl) {
        return fail(
          "generate-cv succeeded but no publish URL found (check gdocs template/token config)",
        );
      }
      const line = buildCvLine(job, docUrl);
      const base = existing?.content.trim() ?? "";
      let content = base ? `${base}\n${line}` : line;
      if (content.length > MAX_NOTE_CONTENT) {
        const lines = content.split("\n");
        while (lines.length > 1 && lines.join("\n").length > MAX_NOTE_CONTENT) {
          const dropAt = lines.findIndex((l) => l.startsWith("- ["));
          lines.splice(dropAt === -1 ? 0 : dropAt, 1);
        }
        content = lines.join("\n");
      }
      if (existing) {
        await jobsRepo.updateJobNote({
          jobId,
          noteId: existing.id,
          title: CV_TAILORING_NOTE_TITLE,
          content,
        });
      } else {
        await jobsRepo.createJobNote({
          jobId,
          title: CV_TAILORING_NOTE_TITLE,
          content,
        });
      }
    }

    // Export published Doc → PDF → upload (marks discovered jobs ready).
    const docId = parseDocId(docUrl);
    if (!docId) return fail("Could not parse Doc ID from publish URL");
    if (!workDir) workDir = await mkdtemp(join(tmpdir(), "cv-tailor-"));
    const exportScript = join(workDir, "export-doc-pdf.py");
    await writeFile(exportScript, EXPORT_SNIPPET, "utf-8");
    // ponytail: capture binary PDF on stdout fd; text decode would corrupt it
    const exported = await new Promise<{
      exitCode: number;
      pdf: Buffer;
      stderr: string;
    }>((resolve) => {
      const child = spawn(
        config.pythonBin,
        [exportScript, config.repoPath, docId],
        { cwd: config.repoPath, stdio: ["ignore", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      let stderr = "";
      let settled = false;
      const done = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, pdf: Buffer.concat(chunks), stderr });
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done(124);
      }, EXPORT_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer | string) =>
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
      );
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        stderr += `\nspawn error: ${error instanceof Error ? error.message : String(error)}`;
        done(127);
      });
      child.on("close", (code) => done(code ?? 1));
    });
    if (exported.exitCode !== 0 || exported.pdf.byteLength < 5) {
      return fail(
        `Doc PDF export failed (exit ${exported.exitCode}): ${exported.stderr.slice(-500)}`,
      );
    }
    const uploaded = await uploadJobPdf({
      jobId,
      fileName: `cv-${buildCvSlug(job)}.pdf`,
      mediaType: "application/pdf",
      dataBase64: exported.pdf.toString("base64"),
    });
    const current = await jobsRepo.getJobById(jobId);
    await jobsRepo.updateJob(jobId, {
      pdfPath: uploaded.outputPath,
      pdfSource: "uploaded",
      pdfRegenerating: false,
      pdfFingerprint: null,
      pdfGeneratedAt: new Date().toISOString(),
      ...(current?.status === "discovered" ? { status: "ready" as const } : {}),
    });
    logger.info("CV tailored for job", { jobId, docUrl });
    return { jobId, success: true, docUrl };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unknown error");
  } finally {
    if (workDir)
      await rm(workDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
  }
}
