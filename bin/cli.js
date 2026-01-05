#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import LogParser from "../lib/log-parser.js";
import SpecGenerator from "../lib/spec-generator.js";

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
  await fs.readFile(path.join(__dirname, "../package.json"), "utf8")
);

program
  .name("vibe-spec")
  .description("Parse and analyze AI Coding Assistant session logs")
  .version(packageJson.version);

program
  .command("list")
  .alias("projects")
  .description("List all available AI Coding Assistant projects")
  .action(async () => {
    const logParser = new LogParser();
    const projects = await logParser.listProjects();

    if (projects.length === 0) {
      console.log(chalk.yellow("No projects found in ~/.claude/projects/"));
    } else {
      console.log(chalk.green(`Found ${projects.length} project(s):\n`));
      projects.forEach((proj) => {
        // Extract the actual project name from the directory name
        const cleanName = proj.replace(/-Users-[^-]+-Documents-git-/, "");
        console.log(`  ${chalk.white(cleanName)}`);
        if (cleanName !== proj) {
          console.log(`    ${chalk.gray(proj)}`);
        }
      });
    }
  });

program
  .command("logs [project]")
  .description(
    "Parse and analyze Claude Code session logs for a project (uses current directory if not specified)"
  )
  .option("-s, --search <keyword>", "Search messages for a keyword")
  .option("--no-timestamp", "Hide timestamps")
  .option("--show-session", "Show session IDs")
  .option("--show-uuid", "Show message UUIDs")
  .option("--limit <number>", "Limit number of messages to display", parseInt)
  .option("--export <file>", "Export messages to a file")
  .option("--include-commands", "Include command executions and outputs")
  .option(
    "--include-tools",
    "Include tool usage indicators in assistant messages"
  )
  .option("--show-original", "Show original content for commands")
  .option("--no-assistant", "Hide assistant messages (only show user messages)")
  .action(async (project, options) => {
    const logParser = new LogParser();
    const projectIdentifier = logParser.getProjectIdentifier(project);

    let messages = await logParser.parseProjectLogs(projectIdentifier, {
      includeTools: options.includeTools,
    });

    if (messages.length === 0) {
      return;
    }

    // Filter messages based on options
    if (!options.assistant) {
      // Hide assistant messages
      messages = messages.filter((msg) => msg.role !== "assistant");
    }

    // Filter out command messages unless requested
    if (!options.includeCommands) {
      messages = messages.filter(
        (msg) =>
          msg.messageType !== "command" && msg.messageType !== "command-output"
      );
    }

    // Filter out tool results unless requested
    if (!options.includeTools) {
      messages = messages.filter((msg) => msg.role !== "tool-result");
    }

    // Apply search filter if provided
    if (options.search) {
      const originalCount = messages.length;
      messages = logParser.searchMessages(messages, options.search);
      console.log(
        chalk.yellow(
          `\nFiltered to ${messages.length} message(s) containing "${options.search}" (from ${originalCount} total)\n`
        )
      );

      if (messages.length === 0) {
        console.log(
          chalk.red("No messages found matching the search criteria.")
        );
        return;
      }
    }

    // Apply limit if specified
    if (options.limit && options.limit > 0) {
      messages = messages.slice(0, options.limit);
    }

    // Format and display messages
    const formatOptions = {
      showTimestamp: options.timestamp !== false,
      showSession: options.showSession,
      showUuid: options.showUuid,
      showOriginal: options.showOriginal,
      hideUserHeader: !options.assistant, // Hide USER header when showing user-only
      includeTools: options.includeTools,
    };

    // Export to file if requested
    if (options.export) {
      const exportData = messages.map((msg) => ({
        timestamp: msg.timestamp,
        content: msg.content,
        role: msg.role || "unknown",
        messageType: msg.messageType,
        sessionId: msg.sessionId,
        uuid: msg.uuid,
      }));

      try {
        await fs.writeFile(options.export, JSON.stringify(exportData, null, 2));
        console.log(
          chalk.green(
            `✓ Exported ${messages.length} message(s) to ${options.export}`
          )
        );
      } catch (error) {
        console.log(chalk.red(`Failed to export: ${error.message}`));
      }
    } else {
      // Display messages in the console
      messages.forEach((message, index) => {
        console.log(logParser.formatMessage(message, formatOptions));
        // Add spacing between messages except after the last one
        if (index < messages.length - 1) {
          console.log("");
        }
      });
    }
  });

program
  .command("stats [project]")
  .description(
    "Show statistics about AI Coding Assistant session logs (uses current directory if not specified)"
  )
  .action(async (project) => {
    const logParser = new LogParser();
    const projectIdentifier = logParser.getProjectIdentifier(project);

    // Parse the project logs with tools included for accurate counts
    const parseOptions = { includeTools: true };
    const messages = await logParser.parseProjectLogs(
      projectIdentifier,
      parseOptions
    );

    if (messages.length === 0) {
      console.log(chalk.yellow("No messages found in project"));
      return;
    }

    // Get and display statistics
    const stats = logParser.getStatistics(messages);
    if (stats) {
      const toolInfo =
        stats.toolResultMessages > 0
          ? `, ${stats.toolResultMessages} tool results`
          : "";
      console.log(
        `${chalk.green("Total Messages:")} ${stats.totalMessages} (${
          stats.userMessages
        } user, ${stats.assistantMessages} assistant, ${
          stats.toolMessages
        } tools${toolInfo})`
      );
      console.log(`${chalk.green("Total Sessions:")} ${stats.totalSessions}`);
      console.log(
        `${chalk.green("Collaboration Time:")} ${stats.activeDuration}`
      );
      console.log(
        `${chalk.green(
          "First Message:"
        )} ${stats.firstMessage.toLocaleString()}`
      );
      console.log(
        `${chalk.green("Last Message:")} ${stats.lastMessage.toLocaleString()}`
      );
      console.log(
        `${chalk.green("Avg Message Length:")} ${
          stats.avgMessageLength
        } characters`
      );
    }
  });

program
  .command("spec [project]")
  .description(
    "Generate project specification from Claude Code logs using OpenAI-compatible API (uses current directory if not specified)"
  )
  .option("-o, --output <file>", "Output specification to a file")
  .option(
    "-c, --chunk-size <number>",
    "Messages per chunk (default: 50)",
    parseInt
  )
  .option("--model <model>", "Model to use (default: gpt-4o-mini or OPENAI_MODEL env)")
  .option("--api-base <url>", "API base URL (or set OPENAI_BASE_URL env)")
  .option("--update", "Update existing specification file instead of replacing")
  .option("--include-tools", "Include tool usage in analysis")
  .action(async (project, options) => {
    const spinner = ora("Loading project logs...").start();

    try {
      // Build SpecGenerator options
      const generatorOptions = {};
      if (options.apiBase) {
        generatorOptions.baseURL = options.apiBase;
      }

      const specGenerator = new SpecGenerator(generatorOptions);
      const logParser = new LogParser();
      const projectIdentifier = logParser.getProjectIdentifier(project);

      // Show API endpoint info
      if (specGenerator.baseURL) {
        spinner.info(`Using API endpoint: ${specGenerator.baseURL}`);
        spinner.start("Loading project logs...");
      }

      // Parse project logs (suppress the log parser's spinner since we have our own)
      const messages = await logParser.parseProjectLogs(projectIdentifier, {
        includeTools: options.includeTools,
        suppressSpinner: true,
      });

      if (messages.length === 0) {
        spinner.fail("No messages found in project");
        return;
      }

      // Filter to only user messages for spec generation
      const userMessages = messages.filter((msg) => msg.role === "user");

      if (userMessages.length === 0) {
        spinner.fail("No user messages found in project");
        return;
      }

      spinner.text = `Found ${userMessages.length} user messages (from ${messages.length} total). Generating specification...`;

      // Load existing spec if updating
      let existingSpec = null;
      if (options.update && options.output) {
        existingSpec = await specGenerator.loadExistingSpec(options.output);
        if (existingSpec) {
          spinner.text = "Updating existing specification...";
        }
      }

      // Generate specification
      const spec = await specGenerator.generateSpec(userMessages, {
        chunkSize: options.chunkSize || 50,
        model: options.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
        existingSpec: existingSpec,
        onProgress: (msg) => {
          spinner.text = msg;
        },
      });

      spinner.succeed("Specification generated successfully!");

      // Output results
      if (options.output) {
        // Save to file
        await fs.writeFile(options.output, spec);
        console.log(chalk.green(`✓ Specification saved to ${options.output}`));
      } else {
        // Output to console
        console.log(spec);
      }
    } catch (error) {
      spinner.fail(
        chalk.red(`Failed to generate specification: ${error.message}`)
      );

      if (error.message.includes("API key")) {
        console.log(chalk.yellow("\nTo set up your API key:"));
        console.log(chalk.gray("1. Create a .env file in the project root"));
        console.log(chalk.gray("2. Add: OPENAI_API_KEY=your-api-key-here"));
        console.log(
          chalk.gray("3. Or set the OPENAI_API_KEY environment variable")
        );
        console.log(chalk.yellow("\nFor OpenAI-compatible APIs:"));
        console.log(chalk.gray("  Add: OPENAI_BASE_URL=https://your-api-endpoint/v1"));
        console.log(chalk.gray("  Or use: --api-base https://your-api-endpoint/v1"));
      }
    }
  });

// Parse command-line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
