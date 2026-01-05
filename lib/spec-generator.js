import { promises as fs } from "node:fs";
import OpenAI from "openai";
import chalk from "chalk";

/**
 * Generate project specifications from Claude Code logs using OpenAI API
 */
export class SpecGenerator {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        chalk.red("OpenAI API key not found!\n") +
          chalk.yellow(
            "Please set OPENAI_API_KEY in your .env file or environment variables."
          )
      );
    }

    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Generate specification from messages
   * @param {Array} messages - Array of parsed messages
   * @param {Object} options - Generation options
   * @returns {Promise<string>} Generated specification in Markdown
   */
  async generateSpec(messages, options = {}) {
    const {
      chunkSize = 50,
      model = "gpt-5-mini",
      existingSpec = null,
      onProgress = () => {},
    } = options;

    if (messages.length === 0) {
      throw new Error("No messages found to analyze");
    }

    // Chunk messages
    const chunks = this.chunkMessages(messages, chunkSize);
    onProgress(`Processing ${chunks.length} chunk(s) of messages...`);

    // Start with existing spec or empty
    let currentSpec = existingSpec || "";

    // Process each chunk, updating the spec each time
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Processing chunk ${i + 1} of ${chunks.length}...`);

      try {
        currentSpec = await this.processChunk(
          chunks[i],
          currentSpec,
          model,
          i === 0 && !existingSpec // First chunk and no existing spec
        );
      } catch (error) {
        console.error(
          chalk.red(`Error processing chunk ${i + 1}: ${error.message}`)
        );
        // Continue with next chunk using the current spec
      }
    }

    // If we're updating an existing spec, add an update section
    if (existingSpec && currentSpec !== existingSpec) {
      currentSpec =
        existingSpec +
        `\n\n## Updates - ${new Date().toLocaleDateString()}\n\n` +
        currentSpec;
    }

    return this.formatAsMarkdown(currentSpec);
  }

  /**
   * Split messages into chunks
   * @param {Array} messages - Messages to chunk
   * @param {number} chunkSize - Max messages per chunk
   * @returns {Array} Array of message chunks
   */
  chunkMessages(messages, chunkSize) {
    const chunks = [];

    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }

    return chunks;
  }

  /**
   * Process a single chunk of messages
   * @param {Array} chunk - Message chunk
   * @param {string} previousContext - Context from previous chunks
   * @param {string} model - OpenAI model to use
   * @param {boolean} isFirst - Is this the first chunk?
   * @returns {Promise<string>} Partial specification
   */
  async processChunk(chunk, previousContext, model, isFirst) {
    // Prepare messages for API (all messages are from users)
    const userRequirementsText = chunk
      .map((msg) => {
        const timestamp = new Date(msg.timestamp).toLocaleString();
        return `[${timestamp}] User: ${msg.content}`;
      })
      .join("\n\n");

    // Create system prompt
    const instructions = `You are analyzing user requirements and requests from a Claude Code session to generate a comprehensive project specification for business analysts.

Focus on extracting and documenting:
1. Main Goals
2. Features
 - For each feature, describe the problem it solves, what it does, and how to use it.
 - Describe user input and expected output.
 - When applicable, include business rules, validation rules, limit and error cases.
 - Group features by functionality (e.g. User Management, Payment Processing, etc.)
3. Overview of Technical Decisions
 - Architecture choices
 - Libraries used, and the reasoning behind them
 - Key Challenges & Solutions
 - Very high-level (no more than 1 page)

DOs:
- Generate a well-structured specification in Markdown format.
- Use different section headers (##, ###) for organization.
- Keep it short and focused on user-facing features and business logic.
- Prefer paragraphs to bullet points.
- Be comprehensive but concise.
- Do not repeatedly describe the same feature. Instead, extract the description and link to it from each occurrence.

DONTs:
- Don't include technical details (file names, code snippets, implementation strategy, etc.).
- Don't repeat structure elements (e.g. "what it does", "problem solved", etc.) for each feature.
- Don't mention tech setup.
- Don't include a table of contents.
- Don't include checklists or a conclusion.
- Don't extract acceptance tests to a standalone section. Mention them as part of the feature description, written as prose.
- Don't mention past features or how the application has evolved. The document should read as a picture of the current state of the application.

Here is an example specification:

<EXAMPLE>
This application is a web-based task management tool allowing users to create, edit, and track tasks. It includes user authentication, task categorization, deadlines, and notifications.

## User Management

### Registration

New users can register by clicking on a register link in the top app bar. This reveals a form allowing them to provide their email, username, and password. Upon registration, a verification email is sent to confirm the email address. Clicking the verification link displays a success message, logging the user in automatically, and redirecting them to the dashboard.

Business Rules:
- Email must be unique.
- Password must be at least 8 characters long and include a number.
- All fields are required.
- Upon successful registration, users are automatically logged in and redirected to the dashboard.
- A verification email can only be used once.
- No more that 5 registrations can be attempted for the same email within an hour.

Content:
- The registration form is titled "Create Your Account".
- Upon submission, the form is replaced with a message: "Thank you for registering! Please check your email to verify your account."
- The confirmation email subject is "Please verify your email for [App Name]".
- The confirmation email body reads: "Click the link below to verify your email and complete your registration."
- The verification success page displays: "Your email has been verified! You are now logged in. You will be redirected to your dashboard shortly."
</EXAMPLE>
`;

    // Combine system prompt and user content for the response API
    const input = isFirst
      ? `Here is the first set of user requirements:
<USER_REQUIREMENTS>
${userRequirementsText}
</USER_REQUIREMENTS>`
      : `Here is the current specification:
<SPECIFICATION>
${previousContext}
</SPECIFICATION>

Update this specification based on the new user requirements. Return the COMPLETE updated specification, not just the changes.
- Add any new features or information to the appropriate sections
- Update existing sections if the user requirements show modifications or pivots
- Maintain the same structure and format
- Keep all existing content that is still relevant

Return the full specification document with all updates integrated.
Here is the new set of user requirements:

<USER_REQUIREMENTS>
${userRequirementsText}
</USER_REQUIREMENTS>
`;

    // Make API call using the response API
    const response = await this.openai.responses.create({
      model,
      instructions,
      input,
      reasoning: { effort: "minimal" },
    });

    return response.output_text;
  }

  /**
   * Format specification as clean Markdown
   * @param {string} spec - Raw specification
   * @returns {string} Formatted Markdown
   */
  formatAsMarkdown(spec) {
    // Clean up any formatting issues
    return spec
      .replace(/\n{3,}/g, "\n\n") // Remove excessive newlines
      .replace(/^#+\s*$/gm, "") // Remove empty headers
      .trim();
  }

  /**
   * Load existing specification from file
   * @param {string} filePath - Path to existing spec file
   * @returns {Promise<string|null>} Existing spec content or null
   */
  async loadExistingSpec(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return content;
    } catch (error) {
      // File doesn't exist, return null
      return null;
    }
  }
}

export default SpecGenerator;
