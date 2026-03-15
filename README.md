# docs-mirror

**Write docs in your GitHub repo. Mirror them everywhere else.**

`docs-mirror` gives any engineering team a turnkey way to keep documentation in their GitHub repository as the source of truth while automatically mirroring that content to Confluence, Linear, or any platform with an HTTP API.

Ship as markdown in your repo, reviewed via pull requests, validated in CI. Product managers, designers, and executives read the same content in the tool they already use. No more choosing between version control and accessibility.

## How It Works

```
push to main → GitHub Action triggers → docs synced to all configured mirrors
```

1. Write markdown in your repo (in `docs/` or wherever you keep them)
2. Add frontmatter metadata (the `init` command does this for you)
3. Push to `main` — the GitHub Action mirrors your docs automatically

Mirrors are **read-only projections**. The repo is always the source of truth. Each mirrored page includes a banner linking back to the GitHub source.

## Quick Start

Install and configure in a single command from your repo directory:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh -s -- init
```

This downloads the binary, adds it to your PATH, and runs the interactive setup. You can also pass flags directly:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh -s -- init --confluence-url https://acme.atlassian.net
```

Or install the binary separately and run init yourself:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh
docs-mirror init
```

Via npm:

```bash
npx docs-mirror init
```

To uninstall:

```bash
docs-mirror uninstall-binary
```

## Supported Mirrors

| Mirror | Status | Content Format |
|---|---|---|
| **Confluence Cloud** | Built-in adapter | Confluence storage format (auto-converted from markdown) |
| **Linear Docs** | Built-in adapter | Markdown (native, no conversion loss) |
| **GitHub Wiki** | Built-in adapter | Markdown (native, pushed via git) |
| **Any HTTP API** | Webhook adapter template | Markdown or HTML (configurable) |

The GitHub Wiki adapter publishes docs directly to your repository's wiki — or another repo's wiki — via git push. The webhook adapter template lets you mirror to WordPress, Ghost, Strapi, Notion, or any CMS with an HTTP API — no code required, just fill out a YAML template.

> [!NOTE]
> **Resource tracking** — All adapters track remote resource IDs in `.docs-mirror-state.json` so that renamed files, changed titles, and updated frontmatter slugs still update the correct remote page instead of creating duplicates. This file is auto-generated on first sync and should be committed to your repository. For the webhook adapter, `delete_page` and `move_page` endpoints are available but disabled by default. Without them, orphaned pages from deleted or renamed source files must be cleaned up manually. See the [webhook template](templates/webhook.yml) for a ready-to-use implementation example.

## Configuration

A single `.docs-mirror.yml` file in your repo root:

```yaml
collection: Engineering Docs

mirrors:
  - adapter: confluence
    url: https://acme.atlassian.net

  - adapter: linear

  - adapter: github-wiki
```

See [Configuration Reference](docs/configuration.md) for all options.

## Frontmatter

Every mirrored markdown file uses standard YAML frontmatter:

```yaml
---
title: "Setup Guide"
publish: true
tags: ["onboarding", "setup"]
---
```

The `init` command adds this automatically. See [Frontmatter Reference](docs/frontmatter.md) for all fields.

## CLI

```bash
docs-mirror init                         # Interactive setup
docs-mirror sync                         # Sync all files to all mirrors
docs-mirror sync --dry-run               # Preview without making changes
docs-mirror uninstall                    # Remove config from this repo
docs-mirror uninstall-binary             # Remove the binary from PATH
```

Adapters are detected automatically from flags and environment variables — no `--adapter` flag needed:

```bash
docs-mirror init --confluence-url https://acme.atlassian.net
docs-mirror sync --confluence-email me@co.com --confluence-token tok123
```

All commands support `--non-interactive` for CI and scripting. CLI flags always take precedence over environment variables. If `gh` CLI is available, secrets can be set automatically during init.

Run `docs-mirror --help` for the full reference.

## GitHub Action

```yaml
- uses: docs-mirror/docs-mirror@v1
  with:
    config: .docs-mirror.yml
  env:
    CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
    CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}
    LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Infrastructure-as-Code

For organizations managing repos at scale, Pulumi and Terraform modules provision `docs-mirror` across fleets of repositories declaratively.

- [Pulumi Module](deploy/pulumi/)
- [Terraform Module](deploy/terraform/)

## Documentation

- [Getting Started](docs/getting-started.md)
- [Configuration Reference](docs/configuration.md)
- [Frontmatter Reference](docs/frontmatter.md)
- [Confluence Setup](docs/adapters/confluence.md)
- [Linear Setup](docs/adapters/linear.md)
- [GitHub Wiki Setup](docs/adapters/github-wiki.md)
- [Webhook / Custom CMS](docs/adapters/webhook.md)
- [Pulumi Guide](docs/advanced/pulumi.md)
- [Terraform Guide](docs/advanced/terraform.md)

## License

[GPL-3.0](LICENSE)
