#!/usr/bin/env node

/**
 * Job Ops CLI — automate the Job Ops API from the command line.
 *
 * Usage:
 *   npx tsx src/cli/index.ts <command> [subcommand] [args...] [options]
 *
 * Commands:
 *   auth          Login, logout, status
 *   app           App status (health check)
 *   pipeline      Pipeline status, run, runs, runs:insights
 *   jobs          List jobs, run actions (skip, move_to_ready, rescore)
 *   backups       List backups, create backup
 *   settings      Get settings
 *   orchestrate   Run scheduled sequence (health → pipeline → backup)
 *
 * Global options:
 *   --api-url     Override the API base URL (default: from config or http://localhost:3001)
 *   --format      Output format: json (default) or table (where supported)
 *
 * Examples:
 *   jobops auth login --username admin --password secret
 *   jobops jobs list --status ready --format table
 *   jobops pipeline run --top-n 15 --sources gradcracker
 *   jobops orchestrate
 *   jobops orchestrate --pipeline-only
 *   jobops orchestrate --skip-backup
 */

import { cmdAppStatus } from "./commands/app.js";
import { dispatchAuth } from "./commands/auth.js";
import { dispatchBackups } from "./commands/backups.js";
import { dispatchJobs } from "./commands/jobs.js";
import { cmdOrchestrate } from "./commands/orchestrate.js";
import { dispatchPipeline } from "./commands/pipeline.js";
import { dispatchSettings } from "./commands/settings.js";
import { loadConfig, saveConfig } from "./lib/config.js";
import { printJson } from "./lib/output.js";

interface ParsedArgs {
  command: string;
  subcommand: string;
  args: string[];
  options: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const tokens = argv.slice(2); // skip "node" and script path
  const args: string[] = [];
  const options: Record<string, string> = {};
  let command = "";
  let subcommand = "";

  let i = 0;

  // Parse command and subcommand (first two non-option tokens)
  while (i < tokens.length && !tokens[i]?.startsWith("-")) {
    if (!command) {
      command = tokens[i]!;
    } else if (!subcommand) {
      subcommand = tokens[i]!;
    } else {
      args.push(tokens[i]!);
    }
    i++;
  }

  // Parse options
  for (; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        const key = token.slice(2, eqIndex);
        const value = token.slice(eqIndex + 1);
        options[key] = value;
      } else {
        // Look ahead for value
        const key = token.slice(2);
        if (i + 1 < tokens.length && !tokens[i + 1]?.startsWith("-")) {
          i++;
          options[key] = tokens[i]!;
        } else {
          options[key] = "true";
        }
      }
    } else if (token.startsWith("-") && !token.startsWith("--")) {
      // Short flags like -f (just treat as key with true)
      const key = token.slice(1);
      options[key] = "true";
    }
  }

  return { command, subcommand, args, options };
}

function showHelp(): void {
  console.log(`
Job Ops CLI — automate your job application pipeline

USAGE
  jobops <command> [subcommand] [args...] [options]

COMMANDS
  auth                      Authentication
    auth login <username>     Log in and store token
    auth logout               Clear stored token
    auth status               Check authentication status

  app                       Server health
    app status                Check server health (no auth)

  pipeline                  Pipeline management
    pipeline status           Check if pipeline is running
    pipeline run              Trigger a pipeline run
    pipeline runs             List recent pipeline runs
    pipeline runs:insights <id>  Get detailed run metrics

  jobs                      Job operations
    jobs list                 List jobs (--status, --view)
    jobs actions <action>     Run action on jobs (--job-ids)

  backups                   Backup management
    backups list              List backups
    backups create            Create a manual backup

  settings                  View settings
    settings get              Show effective settings

  orchestrate               Run scheduled sequence (health → pipeline → backup)
    orchestrate               Full sequence
    orchestrate --pipeline-only    Only run pipeline
    orchestrate --backup-only      Only create backup
    orchestrate --skip-backup      Skip backup step

GLOBAL OPTIONS
  --api-url <url>            Override API base URL
  --format <json|table>      Output format (default: json)

EXAMPLES
  jobops auth login --username admin
  jobops jobs list --status ready --format table
  jobops pipeline run --top-n 15
  jobops orchestrate
`);
}

async function main(): Promise<void> {
  const { command, subcommand, args, options } = parseArgs(process.argv);
  const globalOptions: Record<string, string> = { ...options };

  // Inject --api-url if provided
  if (!globalOptions["api-url"] && process.env.JOBOPS_API_URL) {
    globalOptions["api-url"] = process.env.JOBOPS_API_URL;
  }

  try {
    switch (command) {
      case "auth":
        await dispatchAuth(subcommand || "status", args, globalOptions);
        break;

      case "app":
        if (subcommand === "status" || !subcommand) {
          await cmdAppStatus(globalOptions);
        } else {
          console.error(`Unknown app subcommand: "${subcommand}"`);
          process.exit(1);
        }
        break;

      case "pipeline":
        await dispatchPipeline(subcommand, args, globalOptions);
        break;

      case "jobs":
        await dispatchJobs(subcommand, args, globalOptions);
        break;

      case "backups":
        await dispatchBackups(subcommand, args, globalOptions);
        break;

      case "settings":
        await dispatchSettings(subcommand, args, globalOptions);
        break;

      case "orchestrate":
        await cmdOrchestrate(globalOptions);
        break;

      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;

      case "config":
        // Utility to show current config
        if (subcommand === "show" || !subcommand) {
          const config = loadConfig();
          printJson({ ...config, token: config.token ? "*** (stored)" : null });
        } else if (subcommand === "set-url") {
          const url = args[0];
          if (!url) {
            console.error("Usage: jobops config set-url <api-url>");
            process.exit(1);
          }
          const config = loadConfig();
          saveConfig({ ...config, apiUrl: url });
          console.log(`API URL set to: ${url}`);
        } else {
          console.error(`Unknown config subcommand: "${subcommand}"`);
          process.exit(1);
        }
        break;

      default:
        if (command) {
          console.error(`Unknown command: "${command}"`);
          console.error("Run 'jobops help' for usage.");
        } else {
          showHelp();
        }
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}`);
    process.exit(1);
  }
}

main();
