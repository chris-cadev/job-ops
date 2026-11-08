import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/pipeline", () => ({
  createPipelineRun: vi.fn(async () => ({
    id: "run-cv-scope-1",
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    jobsDiscovered: 0,
    jobsProcessed: 0,
    errorMessage: null,
  })),
  updatePipelineRun: vi.fn(async () => undefined),
}));

vi.mock("../services/cv-tailoring-bridge", () => ({
  resolveCvTailoringConfig: vi.fn(async () => ({
    repoPath: "/tmp/cv-tailoring",
    concurrency: 2,
    timeoutSec: 420,
    pythonBin: "python3",
  })),
}));

vi.mock("./steps", () => ({
  loadProfileStep: vi.fn(async () => ({})),
  discoverJobsStep: vi.fn(async () => ({
    discoveredJobs: [],
    sourceErrors: [],
    pendingChallenges: [],
  })),
  importJobsStep: vi.fn(async () => ({
    created: 0,
    skipped: 0,
    fuzzyMerged: 0,
  })),
  filterNonTargetStep: vi.fn(async () => ({
    checked: 0,
    skipped: 0,
    lastRunAt: new Date().toISOString(),
  })),
  scoreJobsStep: vi.fn(async () => ({
    unprocessedJobs: [],
    scoredJobs: [],
    failedJobIds: [],
  })),
  retryFailedScoringJobs: vi.fn(async () => ({
    recoveredJobIds: [],
    permanentlyFailedJobIds: [],
  })),
  selectJobsStep: vi.fn(() => []),
  processJobsStep: vi.fn(async () => ({ processedCount: 0 })),
  tailorCvsStep: vi.fn(async () => ({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  })),
  notifyPipelineWebhookStep: vi.fn(async () => undefined),
}));

const locationIntent = {
  selectedCountry: "united kingdom",
  country: "united kingdom",
  cityLocations: [] as string[],
  workplaceTypes: [] as Array<"remote" | "hybrid" | "onsite">,
  geoScope: "selected_only" as const,
  searchScope: "selected_only" as const,
  matchStrictness: "flexible" as const,
};

describe.sequential("pipeline CV scoping to survivors", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-pipeline-cv-scope-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("passes exactly the survivor IDs to the scoped tailor step", async () => {
    const pipeline = await import("./orchestrator");
    const steps = await import("./steps");

    vi.mocked(steps.selectJobsStep).mockResolvedValue([
      { id: "s1" },
      { id: "s2" },
    ] as never);
    vi.mocked(steps.processJobsStep).mockResolvedValue({
      processedCount: 2,
    });
    vi.mocked(steps.tailorCvsStep).mockResolvedValue({
      attempted: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
    });

    const result = await pipeline.runPipeline({
      sources: [],
      locationIntent: { ...locationIntent },
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(steps.tailorCvsStep)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(steps.tailorCvsStep)).toHaveBeenCalledWith(
      expect.objectContaining({ jobIds: ["s1", "s2"] }),
    );
  });

  it("reports zeros without failing when no survivors are selected", async () => {
    const pipeline = await import("./orchestrator");
    const pipelineRepo = await import("../repositories/pipeline");
    const steps = await import("./steps");

    vi.mocked(steps.selectJobsStep).mockResolvedValue([]);
    vi.mocked(steps.tailorCvsStep).mockResolvedValue({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    const result = await pipeline.runPipeline({
      sources: [],
      locationIntent: { ...locationIntent },
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(steps.tailorCvsStep)).toHaveBeenCalledWith(
      expect.objectContaining({ jobIds: [] }),
    );
    expect(vi.mocked(pipelineRepo.updatePipelineRun)).toHaveBeenCalledWith(
      "run-cv-scope-1",
      expect.objectContaining({ status: "completed" }),
    );
  });
});
