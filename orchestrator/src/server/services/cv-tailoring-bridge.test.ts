import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
}));

vi.mock("@server/repositories/jobs", () => ({
  getJobById: vi.fn(),
  listJobNotes: vi.fn(),
  createJobNote: vi.fn(),
  updateJobNote: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

vi.mock("@server/services/job-pdf-upload", () => ({
  uploadJobPdf: vi.fn(),
}));

import * as settingsRepo from "@server/repositories/settings";
import {
  buildCvSlug,
  buildJdFileName,
  parseDocId,
  parsePublishUrl,
  parseWroteLine,
  resolveCvTailoringConfig,
  resolveCvTailoringEnabled,
  slugify,
} from "./cv-tailoring-bridge";

describe("cv-tailoring-bridge parsers", () => {
  it("parses WROTE lines", () => {
    expect(
      parseWroteLine(
        "Target path: x\nWROTE: /r/cv--a--b--ats.md (123 chars)\n",
      ),
    ).toBe("/r/cv--a--b--ats.md");
    expect(parseWroteLine("no markers here")).toBeNull();
  });

  it("parses publish URLs", () => {
    const url = "https://docs.google.com/document/d/abc123_XYZ/edit";
    expect(
      parsePublishUrl(
        `publish complete: roles=3 url=${url} elapsed=1s warnings=0 errors=0`,
      ),
    ).toBe(url);
    expect(parsePublishUrl("WARNING: publish failed")).toBeNull();
  });

  it("parses doc IDs", () => {
    expect(
      parseDocId("https://docs.google.com/document/d/abc123_XYZ/edit"),
    ).toBe("abc123_XYZ");
    expect(parseDocId("not a url")).toBeNull();
  });

  it("builds JD filenames and slugs like the python scripts", () => {
    expect(
      buildJdFileName({ title: "Senior Dev (Remote)", employer: "Acme/Inc" }),
    ).toBe("JD - Senior Dev (Remote) - Acme-Inc.md");
    expect(slugify("Senior C++ Engineer!")).toBe("senior-c-engineer");
    expect(
      buildCvSlug({ title: "Senior Engineer", employer: "Acme Inc" }),
    ).toBe("senior-engineer--acme-inc");
  });
});

describe("resolveCvTailoringEnabled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("override wins over settings", async () => {
    await expect(resolveCvTailoringEnabled(true)).resolves.toBe(true);
    await expect(resolveCvTailoringEnabled(false)).resolves.toBe(false);
    expect(settingsRepo.getSetting).not.toHaveBeenCalled();
  });

  it("defaults to off when no setting stored", async () => {
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);
    await expect(resolveCvTailoringEnabled()).resolves.toBe(false);
  });

  it("reads the settings value", async () => {
    vi.mocked(settingsRepo.getSetting).mockResolvedValue("1");
    await expect(resolveCvTailoringEnabled()).resolves.toBe(true);
  });
});

describe("resolveCvTailoringConfig", () => {
  const envBackup = { ...process.env };
  let scratch: string | null = null;

  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    process.env = { ...envBackup };
    if (scratch) {
      await rm(scratch, { recursive: true, force: true });
      scratch = null;
    }
  });

  it("returns null when disabled", async () => {
    await expect(resolveCvTailoringConfig(false)).resolves.toBeNull();
  });

  it("returns null when enabled but no repo path is configured", async () => {
    delete process.env.CV_TAILORING_REPO_PATH;
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);
    await expect(resolveCvTailoringConfig(true)).resolves.toBeNull();
  });

  it("returns null when repo scripts are missing", async () => {
    scratch = await mkdtemp(join(tmpdir(), "cv-cfg-"));
    process.env.CV_TAILORING_REPO_PATH = scratch;
    await expect(resolveCvTailoringConfig(true)).resolves.toBeNull();
  });

  it("resolves config when scripts exist", async () => {
    scratch = await mkdtemp(join(tmpdir(), "cv-cfg-"));
    await writeFile(join(scratch, "_shared-missing"), "");
    const shared = join(scratch, "_shared");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(shared, { recursive: true });
    for (const script of [
      "ingest-jd.py",
      "generate-cv.py",
      "gdocs_publish.py",
    ]) {
      await writeFile(join(shared, script), "# stub");
    }
    process.env.CV_TAILORING_REPO_PATH = scratch;
    const config = await resolveCvTailoringConfig(true);
    expect(config).toMatchObject({
      repoPath: scratch,
      concurrency: 2,
      timeoutSec: 420,
    });
  });

  it("clamps concurrency and timeout", async () => {
    scratch = await mkdtemp(join(tmpdir(), "cv-cfg-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(scratch, "_shared"), { recursive: true });
    for (const script of [
      "ingest-jd.py",
      "generate-cv.py",
      "gdocs_publish.py",
    ]) {
      await writeFile(join(scratch, "_shared", script), "# stub");
    }
    process.env.CV_TAILORING_REPO_PATH = scratch;
    vi.mocked(settingsRepo.getSetting).mockImplementation(async (key) => {
      if (key === "cvTailoringConcurrency") return "99";
      if (key === "cvTailoringTimeoutSec") return "5";
      return null;
    });
    // parse() returns raw ints; bridge clamps to [1,10] / [60,3600].
    const config = await resolveCvTailoringConfig(true);
    expect(config?.concurrency).toBe(10);
    expect(config?.timeoutSec).toBe(60);
  });
});
