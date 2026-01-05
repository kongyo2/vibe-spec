import { promises as fs, readdirSync } from "node:fs";
import os from "node:os";
import path from "path";
import chalk from "chalk";
import ora from "ora";

/**
 * Parse JSONL files and extract user messages
 */
export class LogParser {
  constructor() {
    const homeDir =
      process.env.HOME || process.env.USERPROFILE || os.homedir();
    if (!homeDir) {
      throw new Error(
        "Could not determine home directory. Please set HOME or USERPROFILE environment variable."
      );
    }
    this.baseDir = path.join(homeDir, ".claude", "projects");
  }

  /**
   * Get the project identifier from current working directory or provided name
   */
  getProjectIdentifier(projectName) {
    if (projectName) {
      return projectName;
    }

    // Use current working directory
    const cwd = process.cwd();
    // Handle both Unix (/) and Windows (\) paths
    // Also remove Windows drive letter (e.g., C:)
    const identifier = cwd
      .replace(/^[A-Za-z]:/, "") // Remove Windows drive letter
      .replace(/^[/\\]+/, "") // Remove leading slashes/backslashes
      .replace(/[/\\]+/g, "-"); // Replace path separators with dashes

    return identifier;
  }

  /**
   * Convert project name to directory name
   * @param {string} projectName - The project name (e.g., 'shadcn-admin-kit-kitchen-sink')
   * @returns {Array<string>} Possible directory paths
   */
  getProjectPath(projectName) {
    const possiblePaths = [];

    // First, check if it's already a full directory name
    possiblePaths.push(path.join(this.baseDir, projectName));

    // Try to find directories that end with the project name
    // This handles cases like: -Users-username-path-to-project-name
    try {
      const dirs = readdirSync(this.baseDir);
      for (const dir of dirs) {
        // Check if directory ends with the project name
        if (dir.endsWith(`-${projectName}`) || dir === projectName) {
          possiblePaths.push(path.join(this.baseDir, dir));
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read, continue with basic path
    }

    return possiblePaths;
  }

  /**
   * Parse a single JSONL file
   * @param {string} filePath - Path to the JSONL file
   * @param {Object} options - Parsing options
   * @returns {Promise<Array>} Parsed messages
   */
  async parseJSONLFile(filePath, options = {}) {
    const messages = [];

    try {
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);

          // Extract user messages
          if (data.type === "user" && data.message && data.message.content) {
            // Check if it's a regular user message (string) or tool result (array)
            if (typeof data.message.content === "string") {
              let content = data.message.content;
              let messageType = "user";

              // Detect command messages
              if (
                content.includes("<command-name>") &&
                content.includes("</command-name>")
              ) {
                const commandMatch = content.match(
                  /<command-name>(.*?)<\/command-name>/
                );
                const commandMessageMatch = content.match(
                  /<command-message>(.*?)<\/command-message>/
                );
                const commandArgsMatch = content.match(
                  /<command-args>(.*?)<\/command-args>/
                );

                if (commandMatch) {
                  messageType = "command";
                  content = `[COMMAND: ${commandMatch[1]}]`;
                  if (commandArgsMatch && commandArgsMatch[1].trim()) {
                    content += ` Args: ${commandArgsMatch[1].trim()}`;
                  }
                }
              }
              // Detect command output messages
              else if (content.includes("<local-command-stdout>")) {
                const outputMatch = content.match(
                  /<local-command-stdout>(.*?)<\/local-command-stdout>/s
                );
                if (outputMatch) {
                  messageType = "command-output";
                  content = `[COMMAND OUTPUT: ${outputMatch[1]}]`;
                }
              }
              // Skip caveat messages by default (they're just metadata)
              else if (content.startsWith("Caveat:")) {
                // Skip these metadata messages unless specifically requested
                continue;
              }

              messages.push({
                timestamp: data.timestamp,
                content: content,
                originalContent: data.message.content,
                messageType: messageType,
                uuid: data.uuid,
                sessionId: data.sessionId,
                fileName: path.basename(filePath, ".jsonl"),
                isMeta: data.isMeta || false,
                role: "user",
              });
            } else if (Array.isArray(data.message.content)) {
              // This is a tool result or interrupt message
              let extractedContent = "";
              let messageType = "tool-result";

              for (const item of data.message.content) {
                if (item.type === "tool_result") {
                  // Include tool results (even if empty)
                  const content = item.content || "(empty)";
                  extractedContent += `[TOOL RESULT: ${content}]\n`;
                } else if (item.type === "text" && item.text) {
                  // Include text messages (usually interruptions)
                  extractedContent += item.text + "\n";
                  messageType = "user-interrupt";
                }
              }

              if (extractedContent.trim()) {
                messages.push({
                  timestamp: data.timestamp,
                  content: extractedContent.trim(),
                  originalContent: data.message.content,
                  messageType: messageType,
                  uuid: data.uuid,
                  sessionId: data.sessionId,
                  fileName: path.basename(filePath, ".jsonl"),
                  role:
                    messageType === "user-interrupt" ? "user" : "tool-result",
                });
              }
            }
          }
          // Extract assistant messages
          else if (
            data.type === "assistant" &&
            data.message &&
            data.message.content
          ) {
            let extractedContent = "";
            let hasToolUse = false;

            // Assistant messages have content as an array
            if (Array.isArray(data.message.content)) {
              for (const item of data.message.content) {
                if (item.type === "text" && item.text) {
                  // Extract text content
                  extractedContent += item.text + "\n";
                } else if (item.type === "tool_use") {
                  // Mark that this message includes tool use
                  hasToolUse = true;
                  // Only include tool indicators if requested
                  if (options.includeTools && item.name) {
                    extractedContent += `[TOOL: ${item.name}]\n`;
                  }
                }
              }
            }

            // Only add if there's actual content
            if (extractedContent.trim()) {
              messages.push({
                timestamp: data.timestamp,
                content: extractedContent.trim(),
                originalContent: data.message.content,
                messageType: hasToolUse ? "assistant-with-tools" : "assistant",
                uuid: data.uuid,
                sessionId: data.sessionId,
                fileName: path.basename(filePath, ".jsonl"),
                role: "assistant",
                model: data.message.model || "unknown",
              });
            }
          }
        } catch (parseError) {
          // Skip invalid JSON lines
          console.error(
            chalk.yellow(
              `Warning: Could not parse line in ${path.basename(filePath)}`
            )
          );
        }
      }
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }

    return messages;
  }

  /**
   * Parse all JSONL files in a project directory
   * @param {string} projectName - The project name
   * @param {Object} options - Parsing options
   * @returns {Promise<Array>} All user messages from the project
   */
  async parseProjectLogs(projectName, options = {}) {
    const suppressSpinner = options.suppressSpinner || false;
    const spinner = suppressSpinner
      ? { text: "", stop: () => {}, fail: () => {} }
      : ora("Searching for project logs...").start();

    try {
      const possiblePaths = this.getProjectPath(projectName);
      let projectPath = null;

      // Find the first existing path
      for (const path of possiblePaths) {
        try {
          await fs.access(path);
          projectPath = path;
          break;
        } catch {
          // Path doesn't exist, try next
        }
      }

      if (!projectPath) {
        spinner.fail(
          chalk.red(`Project directory not found for: ${projectName}`)
        );
        console.log(chalk.yellow("\nTip: Try one of these:"));
        console.log(
          chalk.gray(
            "  - Use the full project name as shown in ~/.claude/projects/"
          )
        );
        console.log(
          chalk.gray(
            "  - List available projects with: mycli logs --list-projects"
          )
        );
        return [];
      }

      spinner.text = "Reading log files...";

      // Get all JSONL files in the directory
      const files = await fs.readdir(projectPath);
      const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));

      if (jsonlFiles.length === 0) {
        spinner.fail(
          chalk.yellow(`No log files found in project: ${projectName}`)
        );
        return [];
      }

      spinner.text = `Parsing ${jsonlFiles.length} log file(s)...`;

      // Parse all JSONL files
      const allMessages = [];
      for (const file of jsonlFiles) {
        const filePath = path.join(projectPath, file);
        const messages = await this.parseJSONLFile(filePath, options);
        allMessages.push(...messages);
      }

      // Sort messages by timestamp
      allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Remove duplicates based on UUID
      const uniqueMessages = [];
      const seenUuids = new Set();

      for (const message of allMessages) {
        if (!seenUuids.has(message.uuid)) {
          seenUuids.add(message.uuid);
          uniqueMessages.push(message);
        }
      }

      spinner.stop();

      return uniqueMessages;
    } catch (error) {
      spinner.fail(chalk.red(`Error parsing logs: ${error.message}`));
      return [];
    }
  }

  /**
   * List all available projects
   * @returns {Promise<Array>} List of project names
   */
  async listProjects() {
    try {
      const dirs = await fs.readdir(this.baseDir);
      return dirs.filter((dir) => !dir.startsWith("."));
    } catch (error) {
      console.error(chalk.red(`Error listing projects: ${error.message}`));
      return [];
    }
  }

  /**
   * Format a message for display
   * @param {Object} message - The message object
   * @param {Object} options - Formatting options
   * @returns {string} Formatted message
   */
  formatMessage(message, options = {}) {
    const {
      showTimestamp = true,
      showSession = false,
      showUuid = false,
      showOriginal = false,
      hideUserHeader = false,
      includeTools = false,
    } = options;

    let output = "";

    // Show role (USER, ASSISTANT, or TOOL RESULT)
    if (message.role === "assistant") {
      output += chalk.green.bold("🤖 ASSISTANT: ");
    } else if (message.role === "user" && !hideUserHeader) {
      output += chalk.blue.bold("👤 USER: ");
    } else if (message.role === "tool-result" && includeTools) {
      output += chalk.yellow.bold("🔧 TOOL RESULT: ");
    }

    // Show message type for special messages
    if (message.messageType === "command") {
      output += chalk.yellow("[COMMAND] ");
    } else if (message.messageType === "command-output") {
      output += chalk.yellow("[COMMAND OUTPUT] ");
    } else if (message.messageType === "assistant-with-tools" && includeTools) {
      output += chalk.magenta("[WITH TOOLS] ");
    }

    if (showTimestamp) {
      const date = new Date(message.timestamp);
      output += chalk.gray(`[${date.toLocaleString()}] `);
    }

    if (showSession) {
      output += chalk.yellow(`Session: ${message.fileName} `);
    }

    if (showUuid) {
      output += chalk.gray(`(${message.uuid}) `);
    }

    // Only add newline if we've shown some metadata
    const hasMetadata =
      message.role === "assistant" ||
      (message.role === "user" && !hideUserHeader) ||
      (message.role === "tool-result" && includeTools) ||
      message.messageType === "command" ||
      message.messageType === "command-output" ||
      (message.messageType === "assistant-with-tools" && includeTools) ||
      showTimestamp ||
      showSession ||
      showUuid;

    if (hasMetadata) {
      output += "\n";
    }

    // Format the content
    const content =
      showOriginal && message.originalContent
        ? message.originalContent
        : message.content;
    const contentStr =
      typeof content === "string" ? content : JSON.stringify(content);

    // Show full content without truncation
    output += chalk.white(contentStr);

    // Add final newline if content doesn't end with one
    if (!contentStr.endsWith("\n")) {
      output += "\n";
    }

    return output;
  }

  /**
   * Search messages for a keyword
   * @param {Array} messages - Array of messages
   * @param {string} keyword - Keyword to search for
   * @returns {Array} Filtered messages
   */
  searchMessages(messages, keyword) {
    const lowerKeyword = keyword.toLowerCase();
    return messages.filter((msg) =>
      msg.content.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Get statistics about messages
   * @param {Array} messages - Array of messages
   * @returns {Object} Statistics
   */
  getStatistics(messages) {
    if (messages.length === 0) {
      return null;
    }

    const sessions = new Set(messages.map((m) => m.sessionId));
    const dates = messages.map((m) => new Date(m.timestamp));
    const firstMessage = dates[0];
    const lastMessage = dates[dates.length - 1];

    // Calculate average message length
    const totalLength = messages.reduce(
      (sum, msg) => sum + msg.content.length,
      0
    );
    const avgLength = Math.round(totalLength / messages.length);

    // Count message types
    const userMessages = messages.filter((m) => m.role === "user").length;
    const assistantMessages = messages.filter(
      (m) => m.role === "assistant" && m.messageType !== "assistant-with-tools"
    ).length;
    const toolMessages = messages.filter(
      (m) => m.role === "assistant" && m.messageType === "assistant-with-tools"
    ).length;
    const toolResultMessages = messages.filter(
      (m) => m.role === "tool-result"
    ).length;

    // Calculate collaboration duration
    let totalDuration = 0;
    const maxGap = 5 * 60 * 1000; // 5 minutes - maximum gap to count
    const minMessageTime = 15 * 1000; // 15 seconds minimum per message exchange
    const defaultLastMessageTime = 30 * 1000; // 30 seconds for the last message

    if (messages.length > 0) {
      // Process each message
      for (let i = 0; i < messages.length - 1; i++) {
        const currentMsg = messages[i];
        const nextMsg = messages[i + 1];
        const currentTime = new Date(currentMsg.timestamp);
        const nextTime = new Date(nextMsg.timestamp);
        const gap = nextTime - currentTime;

        if (gap > 0) {
          // For user messages, assume at least minMessageTime for typing/thinking
          // For assistant messages, use actual gap but cap at maxGap
          if (currentMsg.role === "user") {
            totalDuration += Math.min(Math.max(gap, minMessageTime), maxGap);
          } else {
            totalDuration += Math.min(gap, maxGap);
          }
        }
      }

      // Add time for processing the last message
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "user") {
        totalDuration += defaultLastMessageTime * 2; // More time for user's last message
      } else {
        totalDuration += defaultLastMessageTime;
      }
    }

    // Format duration as human-readable string
    const formatDuration = (ms) => {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
      } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
      } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
      } else {
        return `${seconds}s`;
      }
    };

    return {
      totalMessages: messages.length,
      userMessages,
      assistantMessages,
      toolMessages,
      toolResultMessages,
      totalSessions: sessions.size,
      firstMessage,
      lastMessage,
      avgMessageLength: avgLength,
      activeDuration: formatDuration(totalDuration),
    };
  }
}

export default LogParser;
