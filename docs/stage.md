# Stage

The `stage` command scans for markdown files with missing or incomplete frontmatter and adds it
automatically. It has two modes: **normal** (default) and **agent**.

## Usage

```bash
docs-mirror stage [options] [path]
```

| Option            | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `--agent <path>`  | Path to Claude CLI or Cursor CLI executable (enables agent mode) |
| `--key <value>`   | API key for the agent CLI                                        |
| `--config <path>` | Config file path (default: `.docs-mirror.yml`)                   |
| `--dry-run`       | Preview changes without writing files                            |
| `--verbose`       | Show detailed output                                             |
| `<path>`          | Base directory to scan (default: current directory)              |

## Normal mode

Scans `README.md` and `docs/**/*.md` for files that either lack a frontmatter block or are missing
`title`/`slug` fields. For each file it:

1. Extracts a title using the same progressive fallback as `init`: explicit frontmatter → H1 heading
   → filename
2. Generates a slug from the title
3. Sets `publish: true` and pulls `collection` from the config file if present
4. Fixes the primary heading — if the file has no H1 or uses an H2+ where an H1 should be, the
   heading is corrected
5. Injects new frontmatter (or merges into existing partial frontmatter without overwriting set
   values)

```bash
docs-mirror stage
docs-mirror stage --dry-run
docs-mirror stage ./path/to/repo
```

## Agent mode

Uses a Claude CLI or Cursor CLI agent to intelligently determine frontmatter values for each file.
The agent reads file contents, analyzes peer and parent directory conventions, and returns
structured JSON with the recommended frontmatter for every file.

```bash
docs-mirror stage --agent claude --key sk-ant-...
docs-mirror stage --agent /usr/local/bin/claude --key sk-ant-...
docs-mirror stage --agent agent --key cur_...
```

### How it works

1. The CLI executable is validated — if it doesn't exist or fails to run, the error is returned
   immediately
2. The tool type (Claude or Cursor) is detected from the executable name or its `--version` output
3. A prompt is compiled with runtime context: project root, list of files needing frontmatter, path
   to README, path to config, and examples of existing frontmatter from the project
4. The prompt is passed to the CLI in headless non-interactive mode (`-p` flag) with JSON output
   format
5. If the prompt exceeds 20K characters, it is piped via stdin instead of passed as an argument
6. The agent's structured JSON response is parsed and applied — frontmatter is injected/merged, and
   headings are fixed if the agent flagged them

### Authentication

The `--key` flag sets the API key. It maps to:

| Tool       | Environment variable |
| ---------- | -------------------- |
| Claude CLI | `ANTHROPIC_API_KEY`  |
| Cursor CLI | `CURSOR_API_KEY`     |

You can also set the environment variable directly instead of passing `--key`.

### Getting credentials

**Claude CLI** — requires an Anthropic API key. Create one at
[console.anthropic.com](https://console.anthropic.com/) under API Keys. Install the CLI with
`npm install -g @anthropic-ai/claude-code`.

**Cursor CLI** — requires a Cursor API key. Generate one from the Cursor dashboard under Settings →
API. The CLI executable is typically called `agent`.

### What the agent decides

The agent uses a progressive fallback strategy for each frontmatter field:

- **title**: explicit content title → H1 text → sub-heading promoted → peer file convention → parent
  directory convention → filename
- **slug**: always derived from the determined title
- **tags**: peer file conventions → parent directory conventions → inferred from content
- **order**: follows peer ordering patterns or inferred reading order
- **collection**: config default → peer convention
- **publish**: `true` unless the file is clearly a draft or internal

The agent also checks for heading issues (missing H1, or H2/H3/H4 used where H1 belongs) and flags
files that need correction.
