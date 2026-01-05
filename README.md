# @kongyo2/vibe-spec

> Forked from [marmelab/vibe-spec](https://github.com/marmelab/vibe-spec) with OpenAI-compatible API support.

A command-line tool for generating specifications based on Claude Code session logs using **any OpenAI-compatible LLM API**.

## What's Different in This Fork

- **OpenAI-Compatible API Support**: Works with OpenAI, OpenRouter, Together AI, Groq, Ollama, Azure OpenAI, and any other OpenAI-compatible API
- **Configurable API Endpoint**: Use `OPENAI_BASE_URL` environment variable or `--api-base` CLI option
- **Chat Completions API**: Uses the standard `/v1/chat/completions` endpoint for maximum compatibility
- **Scoped npm Package**: Published as `@kongyo2/vibe-spec` on npm

## Problem Statement

Coding with an AI assistant is an iterative process: you describe what you want, report issues, request changes, and so on. As a result, the description of what the application should do is split onto multiple messages exchanged between you and the assistant.

For example, the following conversation log snippet shows how a user incrementally refines the requirements for a 3D sculpting application:

```
[14:06] It works. But I want to modify the mouse interactions. Left click should add matter, and middle click should be used to move the camera

[14:08] Now, I want the "add matter" action to be more realistic. For that, you'll have to consider that clicking on an object is like adding more patter to the surface of the object, updating its geometry instead of rendering another sphere. I really want a sculpting tool.

[14:11] I want that when I keep the left mouse button down, it keeps adding more matter

[14:14] Now I want a toolbar that lets me add primitive shapes (sphere, cube, cylinder, etc) as well as selecting the "add matter" tool. The app should start with an empty scene. The user can add a.g. a sphere, then select the "add matter" tool, and start sculpting that sphere.

[14:19] the sculpt tool no longer works on the objects I've added

[14:20] No, it still doesn't work, clicking on a sphere I just added doesn't deform it

[14:36] When adding matter, the existing vertices grow, and after some time the sculpting tool doesn't work because I'm modifying large triangles, i.e. planes without inner mesh. I think we should fix this by adding a dynamic mesh subdivision system: when the user clicks on a mesh to sculpt it, if the geometry of that spot isn't fine enough, subdivide it to let the user add more details.

[15:20] there seems to be a problem with the subdivision and with the sculpt tool. Let me explain the problem. First, when I use the sculpt tool, the mesh sometimes shows holes. This means the subdivision creates an incorrect geometry, and some divided triangles are along non-divided triangles. Second, the sculpt button doesn't seem to alter the existing mesh in the right way. It should move vertices in the direction of the average normal of all the triangles in the location of the tool. By the way, I'd like a preview of the sculpt tool size, that shows the affected region.

```

The assistant managed to implement the requested features (source code [marmelab/sculpt-3D](https://github.com/marmelab/sculpt-3D)):

https://github.com/user-attachments/assets/3f3c7f82-a05a-400a-be55-bfd3fc1ea78a

However, this process has a significant drawback: there is no single source of truth that describes what the application does, making it hard to understand the full scope of the project later on.

This tool addresses that problem by parsing the conversation logs and reconstructing a clear, structured view of the application's functionality.

For example:

> ### Sculpt Tools
>
> Sculpt tools provide clay-like deformation capabilities with three primary operations: Add,  Subtract, and Push.
>
> Users can select these tools from the toolbar to modify the selected object interactively. With a sculpt tool active and an object selected, moving over the mesh reveals a circular brush preview indicating the affected area. Pressing and holding the pointer down on the mesh begins operation, raycasting to determine hit position and triangle. Add/Subtract displace vertices along an averaged local normal; Push displaces in world-space drag direction. Brush parameters include Brush Size Strength. Users can adjust these via keyboard shortcuts (+/- for size, Shift+ +/- for strength) or UI controls.
>
> Business/validation rules:
> - Sculpting must be continuous and localized;
> - Sculpting operations automatically subdivide the mesh for detail;
> - Affected vertices are limited to brush radius and adjacency rings;
> - Per-frame displacement is clamped to prevent inverted normals or self-intersection;
> - Symmetry options allow mirroring across X, Y, Z axes.
> - Sculpt tools don't cause tearing or mesh artifacts.
>
> Mobile UI adjustments: An optional modal dialog provides compact controls for brushSize, brushStrength and symmetry toggles. This dialog is optional and defaults to collapsed on tool selection to keep the canvas clear.

## Installation

```bash
# Install globally
npm install -g @kongyo2/vibe-spec

# Or with yarn
yarn global add @kongyo2/vibe-spec

# Or with pnpm
pnpm add -g @kongyo2/vibe-spec
```

## API Configuration

To use the specification generation feature, you need an API key from your LLM provider.

### OpenAI (Default)

```bash
export OPENAI_API_KEY=your-api-key-here
```

### OpenAI-Compatible Providers

Set both the API key and base URL:

```bash
# OpenRouter
export OPENAI_API_KEY=your-openrouter-key
export OPENAI_BASE_URL=https://openrouter.ai/api/v1

# Together AI
export OPENAI_API_KEY=your-together-key
export OPENAI_BASE_URL=https://api.together.xyz/v1

# Groq
export OPENAI_API_KEY=your-groq-key
export OPENAI_BASE_URL=https://api.groq.com/openai/v1

# Ollama (local)
export OPENAI_API_KEY=ollama  # Any non-empty string works
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=llama3.2  # Specify your local model

# Azure OpenAI
export OPENAI_API_KEY=your-azure-key
export OPENAI_BASE_URL=https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT
```

### Using .env File

Create a `.env` file in your current working directory:

```bash
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://your-api-endpoint/v1
OPENAI_MODEL=gpt-4o-mini
```

## Usage

```bash
# List all available projects
vibe-spec list

# Show statistics for the current directory (when in a project directory)
vibe-spec stats

# Parse logs for the current directory (when in a project directory)
vibe-spec logs

# Generate specification for the current directory (when in a project directory)
vibe-spec spec

# You can also specify a project name directly:
vibe-spec logs project-name
vibe-spec stats project-name
vibe-spec spec project-name
```

## Log Parsing Options

```bash
# Export messages to a JSON file
vibe-spec logs --export conversation.json

# Show only user messages (hide assistant responses)
vibe-spec logs --no-assistant

# Include tool usage indicators in assistant messages (hidden by default)
vibe-spec logs --include-tools

# Include command executions and outputs (hidden by default)
vibe-spec logs --include-commands

# Search for specific keywords in messages
vibe-spec logs --search "component"

# Limit the number of messages displayed
vibe-spec logs --limit 10

# Hide timestamps
vibe-spec logs --no-timestamp

# Show session IDs
vibe-spec logs --show-session

# Show message UUIDs
vibe-spec logs --show-uuid

# Show original raw content for commands
vibe-spec logs --include-commands --show-original
```

## Specification Generation Options

```bash
# Generate spec to terminal
vibe-spec spec

# Save specification to a file
vibe-spec spec -o spec.md

# Update an existing specification (append new findings)
vibe-spec spec -o spec.md --update

# Use a specific model (default: gpt-4o-mini)
vibe-spec spec --model gpt-4o

# Use a custom API endpoint
vibe-spec spec --api-base https://api.together.xyz/v1 --model meta-llama/Llama-3-70b-chat-hf

# Adjust chunk size for processing (default: 50 messages)
vibe-spec spec --chunk-size 100

# Include tool usage in the analysis
vibe-spec spec --include-tools
```

## How It Works

The tool:
1. Reads JSONL files from `~/.claude/projects/`
2. Parses both user and assistant messages
3. Filters out tool results and metadata by default
4. Presents conversations in chronological order
5. Provides various formatting and export options

## Requirements

- Node.js >= 14.0.0
- npm or yarn
- Access to `~/.claude/projects/` directory
- API key for your chosen LLM provider

## Credits

- Original project: [marmelab/vibe-spec](https://github.com/marmelab/vibe-spec) by François Zaninotto
- This fork: [kongyo2/vibe-spec](https://github.com/kongyo2/vibe-spec)

## License

MIT
