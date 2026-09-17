import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tailorCvsStep } from "./tailor-cvs";

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@server/repositories/jobs", () => ({
  getDiscoveredJobs: vi.fn(),
}));

vi.mock("@server/services/cv-tailoring-bridge", () => ({
  runCvTailoringForJob: vi.fn(),
}));

const config = {
  repoPath: "/tmp/cv-tailoring",
  concurrency: 2,
  timeoutSec: 420,
  pythonBin: "python3",
};

describe("tailorCvsStep", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const jobsRepo = await import("@server/repositories/jobs");
    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([]);
  });

  it("returns zeros when no discovered jobs have descriptions", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { runCvTailoringForJob } = await import(
      "@server/services/cv-tailoring-bridge"
    );
    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([
      createJob({ id: "j1", jobDescription: "  " }),
    ]);

    const result = await tailorCvsStep({ config });

    expect(result).toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });
    expect(runCvTailoringForJob).not.toHaveBeenCalled();
  });

  it("fans out over discovered jobs and aggregates counts", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { runCvTailoringForJob } = await import(
      "@server/services/cv-tailoring-bridge"
    );
    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([
      createJob({ id: "j1", jobDescription: "desc 1" }),
      createJob({ id: "j2", jobDescription: "desc 2" }),
      createJob({ id: "j3", jobDescription: "desc 3" }),
    ]);
    vi.mocked(runCvTailoringForJob)
      .mockResolvedValueOnce({ jobId: "j1", success: true })
      .mockResolvedValueOnce({ jobId: "j2", success: false, error: "boom" })
      .mockResolvedValueOnce({ jobId: "j3", success: false, skipped: true });

    const result = await tailorCvsStep({ config });

    expect(result).toEqual({
      attempted: 3,
      succeeded: 1,
      failed: 1,
      skipped: 1,
    });
    expect(runCvTailoringForJob).toHaveBeenCalledTimes(3);
  });

  it("never throws when the bridge throws", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { runCvTailoringForJob } = await import(
      "@server/services/cv-tailoring-bridge"
    );
    vi.mocked(jobsRepo.getDiscoveredJobs).mockResolvedValue([
      createJob({ id: "j1", jobDescription: "desc" }),
    ]);
    vi.mocked(runCvTailoringForJob).mockRejectedValue(new Error("unexpected"));

    const result = await tailorCvsStep({ config });

    expect(result.failed).toBe(1);
  });
});
