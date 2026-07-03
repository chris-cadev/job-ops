import '../config/env';

import { existsSync } from 'node:fs';
import {
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { closeDb } from '../db/index';
import { getJobsForProcessing } from '../repositories/jobs';

const jdDir = process.env.JD_OUTPUT_DIR ?? "/app/jds";

const sanitize = (str: string) => str.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();

function slug(employer: string, title: string): string {
  return sanitize(`JD - ${title} - ${employer}`);
}

async function main(): Promise<void> {
  const jobs = await getJobsForProcessing(500);

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of jobs) {
    if (!job.jobDescription) continue;

    const s = slug(job.employer ?? "", job.title);
    const filePath = join(jdDir, `${s}.md`);

    if (existsSync(filePath)) {
      skipped++;
      continue;
    }

    try {
      await mkdir(jdDir, { recursive: true });
      await writeFile(filePath, job.jobDescription, "utf-8");
      written++;
    } catch (err) {
      console.error(`Failed to write ${s}.md:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  console.log(
    `JD sync: ${written} written, ${skipped} skipped, ${errors} errors`,
  );

  closeDb();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("JD sync fatal:", err);
  closeDb();
  process.exit(1);
});
