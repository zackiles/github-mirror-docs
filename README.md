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

## Install

Install the standalone binary:

```bash
curl -fsSL https://raw.githubusercontent.com/docs-mirror/docs-mirror/main/install.sh | sh
```

Or via npm:

```bash
npx docs-mirror --help
```

To uninstall the binary:

```bash
docs-mirror uninstall-binary
```

## Quick Start

```bash
docs-mirror init
```

The interactive setup takes under two minutes:
- Select which mirrors to configure (Confluence, Linear, or both)
- Scan your repo for markdown files
- Add frontmatter to discovered files
- Generate `.docs-mirror.yml` config and the GitHub Actions workflow

Then commit, push to `main`, and your first sync runs automatically.

Non-interactive mode uses safe defaults:

```bash
docs-mirror init --non-interactive --adapter confluence --confluence-url https://acme.atlassian.net
```

## Supported Mirrors

| Mirror | Status | Content Format |
|---|---|---|
| **Confluence Cloud** | Built-in adapter | Confluence storage format (auto-converted from markdown) |
| **Linear Docs** | Built-in adapter | Markdown (native, no conversion loss) |
| **Any HTTP API** | Webhook adapter template | Markdown or HTML (configurable) |

The webhook adapter template lets you mirror to WordPress, Ghost, Strapi, Notion, or any CMS with an HTTP API — no code required, just fill out a YAML template.

## Configuration

A single `.docs-mirror.yml` file in your repo root:

```yaml
collection: Engineering Docs

mirrors:
  - adapter: confluence
    url: https://acme.atlassian.net

  - adapter: linear
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

All commands support `--non-interactive` for CI and scripting. Secrets can be passed as CLI flags (which take precedence over environment variables):

```bash
docs-mirror sync --confluence-email me@co.com --confluence-token tok123
```

Run `docs-mirror --help` for the full flag reference.

## GitHub Action

```yaml
- uses: docs-mirror/docs-mirror@v1
  with:
    config: .docs-mirror.yml
  env:
    CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
    CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}
    LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
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
- [Webhook / Custom CMS](docs/adapters/webhook.md)
- [Pulumi Guide](docs/advanced/pulumi.md)
- [Terraform Guide](docs/advanced/terraform.md)

## License

[GPL-3.0](LICENSE)
