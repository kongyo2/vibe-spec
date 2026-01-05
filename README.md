# Vibe Spec

A command-line tool for generating specifications based on Claude Code session logs.

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
npm install -g vibe-spec

# Or with yarn
yarn global add vibe-spec
```

To use the specification generation feature, you need an OpenAI API key:

1. Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)

2. Set up your API key using one of these methods:

   **Option A: Environment Variable (Recommended)**
   ```bash
   export OPENAI_API_KEY=your-api-key-here
   ```

   **Option B: .env file in your project directory**

   Create a `.env` file in your current working directory (where you run `vibe-spec`):
   ```bash
   echo "OPENAI_API_KEY=your-api-key-here" > .env
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

# Use a specific OpenAI model (default: gpt-5-mini)
vibe-spec spec --model gpt-5

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
- OpenAI API key (for specification generation)

## Next Steps

- Allow iterative spec refinement (using only logs produced after the spec file last update date)
- Support other coding AI platforms (e.g., GitHub Copilot, Gemini CLI, etc.)
- Add an MCP server to trigger spec update via commands (e.g. `update specs`)

## License

MIT