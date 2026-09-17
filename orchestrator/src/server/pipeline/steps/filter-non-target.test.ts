import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterNonTargetStep } from "./filter-non-target";

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@server/repositories/jobs", () => ({
  getDiscoveredJobs: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  setSetting: vi.fn(),
}));

vi.mock("@server/services/target-filter/profile", () => ({
  loadTargetProfile: vi.fn(),
}));

vi.mock("@server/services/target-filter/filter", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  classifyJobTarget: vi.fn(),
  classifyJobBatch: vi.fn(),
}));

describe("filterNonTargetStep", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { loadTargetProfile } = await import(
      "@server/services/target-filter/profile"
    );
    vi.mocked(loadTargetProfile).mockResolvedValue({
      text: "profile",
      source: "test.md",
    });
  });

  it("marks off-target jobs as skipped via a single batch call", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const { classifyJobBatch, classifyJobTarget } = await import(
      "@server/services/target-filter/filter"
    );

    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "j1",
        title: "Senior QA Engineer",
        status: "discovered",
        suitabilityScore: null,
      }),
      createJob({
        id: "j2",
        title: "Software Engineer",
        status: "discovered",
        suitabilityScore: null,
      }),
    ]);
    vi.mocked(classifyJobBatch).mockResolvedValue({
      success: true,
      verdicts: [
        { isTarget: false, reason: "QA role" },
        { isTarget: true, reason: "Software role" },
      ],
    });
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(null);
    vi.mocked(settingsRepo.setSetting).mockResolvedValue(undefined);

    const result = await filterNonTargetStep({ pipelineRunId: "run-1" });

    expect(result).toMatchObject({ checked: 2, skipped: 1 });
    expect(classifyJobBatch).toHaveBeenCalledTimes(1);
    expect(classifyJobTarget).not.toHaveBeenCalled();
    expect(jobsRepo.updateJob).toHaveBeenCalledTimes(1);
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "j1",
      expect.objectContaining({ status: "skipped" }),
    );
    expect(settingsRepo.setSetting).toHaveBeenCalledWith(
      "targetFilterState",
      expect.stringContaining("run-1"),
    );
  });

  it("is a no-op when there is nothing to filter", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const { classifyJobBatch } = await import(
      "@server/services/target-filter/filter"
    );
    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([]);
    vi.mocked(settingsRepo.setSetting).mockResolvedValue(undefined);

    const result = await filterNonTargetStep();
    expect(result).toMatchObject({ checked: 0, skipped: 0 });
    expect(classifyJobBatch).not.toHaveBeenCalled();
    expect(jobsRepo.updateJob).not.toHaveBeenCalled();
  });

  it("evaluates discovered jobs even when already scored", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const { classifyJobBatch } = await import(
      "@server/services/target-filter/filter"
    );

    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "j1",
        title: "Senior QA Engineer",
        status: "discovered",
        suitabilityScore: 80,
        suitabilityReason: "High fit",
      }),
    ]);
    vi.mocked(classifyJobBatch).mockResolvedValue({
      success: true,
      verdicts: [{ isTarget: false, reason: "QA role" }],
    });
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(null);
    vi.mocked(settingsRepo.setSetting).mockResolvedValue(undefined);

    const result = await filterNonTargetStep();

    expect(result).toMatchObject({ checked: 1, skipped: 1 });
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "j1",
      expect.objectContaining({
        status: "skipped",
        suitabilityReason: expect.stringContaining("off-target"),
      }),
    );
  });

  it("retries a failed batch one by one", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const { classifyJobBatch, classifyJobTarget } = await import(
      "@server/services/target-filter/filter"
    );

    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "j1",
        title: "Senior QA Engineer",
        status: "discovered",
        suitabilityScore: null,
      }),
      createJob({
        id: "j2",
        title: "Software Engineer",
        status: "discovered",
        suitabilityScore: null,
      }),
    ]);
    vi.mocked(classifyJobBatch).mockResolvedValue({
      success: false,
      error: "bad json",
    });
    vi.mocked(classifyJobTarget).mockImplementation(async ({ job }) => ({
      isTarget: job.id !== "j1",
      reason: job.id === "j1" ? "QA role" : "Software role",
    }));
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(null);
    vi.mocked(settingsRepo.setSetting).mockResolvedValue(undefined);

    const result = await filterNonTargetStep();

    expect(result).toMatchObject({ checked: 2, skipped: 1 });
    expect(classifyJobTarget).toHaveBeenCalledTimes(2);
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "j1",
      expect.objectContaining({ status: "skipped" }),
    );
  });

  it("keeps entry-level jobs without calling the LLM", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const { classifyJobBatch, classifyJobTarget } = await import(
      "@server/services/target-filter/filter"
    );

    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "j1",
        title: "Junior QA Engineer",
        status: "discovered",
        suitabilityScore: null,
      }),
      createJob({
        id: "j2",
        title: "Software Engineer",
        status: "discovered",
        suitabilityScore: null,
      }),
    ]);
    vi.mocked(classifyJobBatch).mockResolvedValue({
      success: true,
      verdicts: [{ isTarget: true, reason: "Software role" }],
    });
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(null);
    vi.mocked(settingsRepo.setSetting).mockResolvedValue(undefined);

    const result = await filterNonTargetStep();

    expect(result).toMatchObject({ checked: 2, skipped: 0 });
    // Only the non-entry job reaches the batch.
    expect(classifyJobBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: [expect.objectContaining({ id: "j2" })],
      }),
    );
    expect(classifyJobTarget).not.toHaveBeenCalled();
    expect(jobsRepo.updateJob).not.toHaveBeenCalled();
  });
});
