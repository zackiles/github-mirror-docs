# Getting Started

docs-mirror keeps your GitHub repository as the source of truth for documentation while automatically syncing it to Confluence, Linear, and other platforms via a webhook adapter.

## Prerequisites

- A GitHub repository with markdown docs (e.g. `README.md`, `docs/**/*.md`)
- Accounts on the target platforms you want to mirror to (Confluence, Linear, etc.)

## Install

Install the standalone binary:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh
```

Or use npx (requires Node.js):

```bash
npx docs-mirror --help
```

## Step 1: Run init

```bash
docs-mirror init
```

The interactive setup walks you through:

| Prompt | Description |
|--------|-------------|
| Configure Confluence mirror? (Y/n) | Add Confluence as a mirror. Answer `n` to skip. |
| Configure Linear mirror? (Y/n) | Add Linear as a mirror. Answer `n` to skip. At least one adapter is required. |
| Confluence base URL | Your Confluence instance URL (e.g. `https://acme.atlassian.net`). Shown only if Confluence is selected. |
| Default collection name | Name for the Confluence Space or Linear Project (e.g. "Engineering Docs"). |
| Exclude any paths from mirroring? | Glob pattern to exclude files, or leave blank. |
| Add frontmatter to N files and create config? (Y/n) | Confirm to write changes. Answer `n` to abort. |

For non-interactive usage (CI, scripting):

```bash
docs-mirror init --non-interactive --adapter confluence --confluence-url https://acme.atlassian.net --collection "Engineering Docs"
```

## Step 2: Review generated files

After init, review:

- **`.docs-mirror.yml`** — Mirror configuration (collection, source paths, adapters)
- **`.github/workflows/docs-mirror.yml`** — GitHub Action that runs sync on push to `main`
- **Markdown files** — Frontmatter added or merged (title, slug, publish, collection)

## Step 3: Add secrets to GitHub

In your repository: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description |
|--------|-------------|
| `CONFLUENCE_EMAIL` | Your Confluence account email |
| `CONFLUENCE_TOKEN` | API token from [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `LINEAR_API_KEY` | Personal API key from Linear → Settings → API → Personal API keys |

Add only the secrets for the adapters you configured.

## Step 4: Commit and push to main

```bash
git add .docs-mirror.yml .github/workflows/docs-mirror.yml README.md docs/
git commit -m "Add docs-mirror"
git push origin main
```

## Step 5: Verify sync ran

Open **Actions** in your GitHub repository. The "Mirror Docs" workflow runs on pushes to `main` that touch `README.md`, `docs/**`, or `.docs-mirror.yml`. Check the run logs to confirm pages were created or updated.

## Local sync

Run sync locally to test or push changes without waiting for CI:

```bash
docs-mirror sync
```

Options:

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would happen without making changes |
| `--adapter <name>` | Sync to a single adapter (`confluence`, `linear`, or `webhook`) |
| `--config <path>` | Config file path (default: `.docs-mirror.yml`) |
| `--confluence-email <email>` | Override CONFLUENCE_EMAIL env var |
| `--confluence-token <token>` | Override CONFLUENCE_TOKEN env var |
| `--linear-api-key <key>` | Override LINEAR_API_KEY env var |
| `<file>` | Sync only the specified file(s) |

For local sync, credentials come from CLI flags, environment variables, or a `.env` file in the repo root (in that precedence order). Ensure `.env` is in `.gitignore` (init adds it if missing). Example `.env`:

```
CONFLUENCE_EMAIL=you@company.com
CONFLUENCE_TOKEN=your-api-token
LINEAR_API_KEY=lin_api_...
```

## Uninstall

Remove docs-mirror config from your repository:

```bash
docs-mirror uninstall
```

You will be prompted for:

- Remove `.github/workflows/docs-mirror.yml`? (Y/n)
- Remove `.docs-mirror.yml`? (Y/n)
- Strip docs-mirror frontmatter from markdown files? (y/N)

Non-interactive:

```bash
docs-mirror uninstall --non-interactive --strip-frontmatter
```

After uninstall, manually remove GitHub Actions secrets and any mirrored pages in Confluence or Linear if desired.

To remove the docs-mirror binary from your system:

```bash
docs-mirror uninstall-binary
```

## Next steps

- [Configuration Reference](configuration.md) — Full `.docs-mirror.yml` options
- [Frontmatter Reference](frontmatter.md) — Per-file metadata fields
- [Confluence Setup](adapters/confluence.md) — Confluence-specific setup
- [Linear Setup](adapters/linear.md) — Linear-specific setup
- [Webhook / Custom CMS](adapters/webhook.md) — Mirror to any HTTP API
