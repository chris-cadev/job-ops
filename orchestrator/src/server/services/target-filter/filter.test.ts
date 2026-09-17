import { beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonMock, createConfiguredLlmServiceMock, resolveLlmModelMock } =
  vi.hoisted(() => ({
    callJsonMock: vi.fn(),
    createConfiguredLlmServiceMock: vi.fn(),
    resolveLlmModelMock: vi.fn(),
  }));

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@server/services/modelSelection", () => ({
  createConfiguredLlmService: createConfiguredLlmServiceMock,
  resolveLlmModel: resolveLlmModelMock,
}));

import {
  buildTargetBatchPrompt,
  buildTargetFilterPrompt,
  chunkJobsByBudget,
  classifyJobBatch,
  classifyJobTarget,
  isEntryLevelTitle,
} from "./filter";

const job = {
  id: "job-1",
  title: "Senior QA Engineer",
  employer: "Acme",
  jobDescription: "Manual testing",
};

const job2 = {
  id: "job-2",
  title: "Software Engineer",
  employer: "Acme",
  jobDescription: "TypeScript and React",
};

describe("target filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveLlmModelMock.mockResolvedValue("test-model");
    createConfiguredLlmServiceMock.mockResolvedValue({
      callJson: callJsonMock,
    });
  });

  it("treats every entry-level title as target without calling the LLM", async () => {
    expect(isEntryLevelTitle("Junior QA Engineer")).toBe(true);
    expect(isEntryLevelTitle("Entry-Level Data Scientist")).toBe(true);
    expect(isEntryLevelTitle("Graduate Hardware Engineer")).toBe(true);
    expect(isEntryLevelTitle("Software Intern")).toBe(true);
    expect(isEntryLevelTitle("Senior QA Engineer")).toBe(false);

    const result = await classifyJobTarget({
      job: { ...job, title: "Junior QA Engineer" },
      profileMd: "target",
    });
    expect(result.isTarget).toBe(true);
    expect(createConfiguredLlmServiceMock).not.toHaveBeenCalled();
  });

  it("returns the LLM verdict for non-entry titles", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: { isTarget: false, reason: "QA role" },
    });
    const result = await classifyJobTarget({ job, profileMd: "target" });
    expect(result).toEqual({ isTarget: false, reason: "QA role" });
  });

  it("keeps the job when the LLM call fails", async () => {
    callJsonMock.mockResolvedValue({ success: false, error: "boom" });
    const result = await classifyJobTarget({ job, profileMd: "target" });
    expect(result.isTarget).toBe(true);
  });

  it("sends only title/employer/truncated description in the prompt", () => {
    const prompt = buildTargetFilterPrompt(
      { ...job, jobDescription: "x".repeat(5000) },
      "PROFILE",
    );
    expect(prompt).toContain("Senior QA Engineer");
    expect(prompt).toContain("PROFILE");
    expect(prompt.length).toBeLessThan(5000);
  });

  it("builds a numbered batch prompt with the profile once", () => {
    const prompt = buildTargetBatchPrompt([job, job2], "PROFILE");
    expect(prompt).toContain("JOB #0");
    expect(prompt).toContain("JOB #1");
    expect(prompt).toContain("Senior QA Engineer");
    expect(prompt).toContain("Software Engineer");
    expect(prompt.match(/--- TARGET PROFILE ---/g)?.length).toBe(1);
  });

  it("maps batch verdicts by job index", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        results: [
          { jobIndex: 1, isTarget: true, reason: "Software role" },
          { jobIndex: 0, isTarget: false, reason: "QA role" },
        ],
      },
    });
    const result = await classifyJobBatch({
      jobs: [job, job2],
      profileMd: "target",
    });
    expect(result).toEqual({
      success: true,
      verdicts: [
        { isTarget: false, reason: "QA role" },
        { isTarget: true, reason: "Software role" },
      ],
    });
    expect(createConfiguredLlmServiceMock).toHaveBeenCalledTimes(1);
  });

  it("fails the batch when a verdict is missing or invalid", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: { results: [{ jobIndex: 0, isTarget: false, reason: "QA" }] },
    });
    const missing = await classifyJobBatch({
      jobs: [job, job2],
      profileMd: "target",
    });
    expect(missing.success).toBe(false);

    callJsonMock.mockResolvedValue({ success: false, error: "boom" });
    const failed = await classifyJobBatch({
      jobs: [job],
      profileMd: "target",
    });
    expect(failed).toEqual({ success: false, error: "boom" });
  });

  it("splits jobs into budget-sized chunks", () => {
    const big = { ...job, jobDescription: "x".repeat(10_000) };
    const chunks = chunkJobsByBudget([job, job2, big], 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(3);
    expect(chunkJobsByBudget([])).toEqual([]);
    // A single oversized job goes alone, never dropped.
    expect(chunkJobsByBudget([big], 100)).toEqual([[big]]);
  });
});
