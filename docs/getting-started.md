# Getting Started

docs-mirror keeps your GitHub repository as the source of truth for documentation while automatically syncing it to Confluence, Linear, and other platforms via a webhook adapter.

## Prerequisites

- A GitHub repository with markdown docs (e.g. `README.md`, `docs/**/*.md`)
- Accounts on the target platforms you want to mirror to (Confluence, Linear, etc.)

## Install and Setup

The fastest path — install the binary and run init in one command from your repo directory:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh -s -- init
```

You can pass flags directly to skip prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh -s -- init --confluence-url https://acme.atlassian.net
```

To install the binary without running init:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh
```

Or use npx (requires Node.js):

```bash
npx docs-mirror init
```

## What init does

The interactive setup detects your environment and walks you through configuration:

| Step | Description |
|------|-------------|
| Detect git repo | Reads the remote URL to derive `root_page` and collection defaults. |
| Detect adapters | Infers adapters from flags and environment variables. If none found, prompts you. |
| Validate credentials | Tests Confluence URL + credentials and Linear API key if available. |
| Scan markdown | Finds `README.md` and `docs/**/*.md` and shows discovered titles. |
| Add frontmatter | Injects or merges frontmatter (title, slug, publish, collection). |
| Generate config | Creates `.docs-mirror.yml` and `.github/workflows/docs-mirror.yml`. |
| Set GitHub secrets | If `gh` CLI is authenticated, offers to set secrets automatically. |

Adapters are inferred from flags — no `--adapter` flag needed:

```bash
docs-mirror init --confluence-url https://acme.atlassian.net
docs-mirror init --linear-api-key lin_api_xxx
docs-mirror init --confluence-url https://acme.atlassian.net --linear-api-key lin_api_xxx
```

For fully non-interactive setup:

```bash
docs-mirror init --non-interactive --confluence-url https://acme.atlassian.net --collection "Engineering Docs"
```

## Credentials

### From environment variables

Set credentials in your shell or a `.env` file:

```
CONFLUENCE_EMAIL=you@company.com
CONFLUENCE_TOKEN=your-api-token
LINEAR_API_KEY=lin_api_...
```

### From CLI flags

CLI flags override environment variables:

```bash
docs-mirror sync --confluence-email me@co.com --confluence-token tok123
```

### Via GitHub CLI

If `gh` is installed and authenticated, init will offer to set GitHub Actions secrets automatically. No need to visit the GitHub settings UI.

### Interactive credential setup

If credentials are missing during interactive init, the CLI will:

1. Check for the Atlassian CLI (`atlas`) and offer to help generate tokens
2. Offer to open your browser to the API token creation page
3. Let you enter credentials directly, saving them to `.env` for local development
4. Offer to set them as GitHub Actions secrets via `gh` CLI

## Review generated files

After init, review:

- **`.docs-mirror.yml`** — Mirror configuration (collection, source paths, adapters)
- **`.github/workflows/docs-mirror.yml`** — GitHub Action that runs sync on push to `main`
- **Markdown files** — Frontmatter added or merged (title, slug, publish, collection)

## Add secrets to GitHub

If you didn't use the `gh` CLI to set secrets during init:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description |
|--------|-------------|
| `CONFLUENCE_EMAIL` | Your Confluence account email |
| `CONFLUENCE_TOKEN` | API token from [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `LINEAR_API_KEY` | Personal API key from Linear → Settings → API → Personal API keys |

Add only the secrets for the adapters you configured.

## Commit and push

```bash
git add .docs-mirror.yml .github/workflows/docs-mirror.yml README.md docs/
git commit -m "Add docs-mirror"
git push origin main
```

## Verify

Open **Actions** in your GitHub repository. The "Mirror Docs" workflow runs on pushes to `main` that touch `README.md`, `docs/**`, or `.docs-mirror.yml`.

## Local sync

```bash
docs-mirror sync
docs-mirror sync --dry-run
docs-mirror sync --confluence-email me@co.com --confluence-token tok123
```

Passing adapter-specific flags to sync automatically scopes the sync to that adapter.

## Uninstall

Remove docs-mirror config from your repository:

```bash
docs-mirror uninstall
```

If `gh` CLI is available, you'll be offered the option to remove GitHub Actions secrets automatically.

Non-interactive:

```bash
docs-mirror uninstall --non-interactive --strip-frontmatter
```

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
