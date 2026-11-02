import { AppError } from "@infra/errors";
import { describe, expect, it } from "vitest";
import { classifyPdfGenerationError } from "./pdf";
import { RxResumeRequestError } from "./rxresume";

describe("classifyPdfGenerationError", () => {
  it("maps a Reactive Resume 401 to UNAUTHORIZED", () => {
    expect(
      classifyPdfGenerationError(
        new RxResumeRequestError(
          "Reactive Resume API error (401): Unauthorized",
          401,
        ),
      ),
    ).toBe("UNAUTHORIZED");
  });

  it("maps a 401 message without a status to UNAUTHORIZED", () => {
    expect(
      classifyPdfGenerationError(
        new RxResumeRequestError(
          "Reactive Resume API error (401): Unauthorized",
        ),
      ),
    ).toBe("UNAUTHORIZED");
  });

  it("keeps non-401 Reactive Resume failures as UPSTREAM_ERROR", () => {
    expect(
      classifyPdfGenerationError(
        new RxResumeRequestError(
          "Reactive Resume API error (500): Failed to generate PDF",
          500,
        ),
      ),
    ).toBe("UPSTREAM_ERROR");
  });

  it("passes AppError codes through unchanged", () => {
    expect(
      classifyPdfGenerationError(
        new AppError({
          status: 409,
          code: "CONFLICT",
          message: "Superseded",
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("maps aborts to REQUEST_TIMEOUT and unknown errors to INTERNAL_ERROR", () => {
    const abort = new Error("Aborted");
    abort.name = "AbortError";
    expect(classifyPdfGenerationError(abort)).toBe("REQUEST_TIMEOUT");
    expect(classifyPdfGenerationError(new Error("boom"))).toBe(
      "INTERNAL_ERROR",
    );
  });
});
