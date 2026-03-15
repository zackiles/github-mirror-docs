# GitHub Wiki Setup

This guide walks through configuring docs-mirror to sync documentation to a GitHub repository wiki.

## Prerequisites

- A GitHub repository with the Wiki feature enabled (Settings → Features → Wikis)
- A GitHub token with push access to the wiki

## Credentials

docs-mirror uses `GITHUB_TOKEN` for authentication.

**In GitHub Actions**, the built-in `${{ github.token }}` works automatically for the current repository's wiki. No additional secrets are needed — just grant `contents: write` permission to the workflow.

**For local development**, create a Personal Access Token:

1. Go to [GitHub Token Settings](https://github.com/settings/tokens/new?scopes=repo&description=docs-mirror)
2. Select the `repo` scope
3. Generate and copy the token

Set it as an environment variable (or add to `.env`):

```
GITHUB_TOKEN=ghp_your-token-here
```

## Configuration

Add the GitHub Wiki mirror to `.docs-mirror.yml`:

```yaml
collection: My Project Docs

mirrors:
  - adapter: github-wiki
```

That's the minimal config. docs-mirror will:

- Detect the current repository from the git remote
- Clone the wiki, write pages as markdown files, and push
- Use your `README.md` as the wiki Home page
- Auto-generate a `_Sidebar.md` with ordered navigation

For more control:

```yaml
mirrors:
  - adapter: github-wiki
    repo: myorg/other-repo
    root_page: Documentation
    banner: true
```

| Field | Description |
|-------|-------------|
| `repo` | Target repository as `owner/name`. Defaults to the current repo. |
| `root_page` | Title for the Home page. Defaults to README.md title, then repo name. |
| `banner` | Add "Mirrored from GitHub" notice at the top of each page. Default `true`. |
| `lock` | Not applicable — GitHub Wiki does not support per-page edit restrictions. |

## Cross-repository publishing

To publish docs to a **different** repository's wiki:

```yaml
mirrors:
  - adapter: github-wiki
    repo: myorg/docs-wiki
```

Cross-repo publishing requires a Personal Access Token (PAT) with `repo` scope — the default `GITHUB_TOKEN` in Actions only has access to the current repository. Add the PAT as a repository secret and reference it in your workflow:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.WIKI_PAT }}
```

## How pages map to the wiki

GitHub Wiki stores pages as markdown files in a git repository. docs-mirror maps your documentation like this:

```
Wiki repository:
  ├── Home.md              ← from README.md (root page)
  ├── _Sidebar.md          ← auto-generated navigation
  ├── getting-started.md   ← from docs/getting-started.md
  ├── configuration.md     ← from docs/configuration.md
  └── api-reference.md     ← from docs/api/reference.md
```

**Key behaviors:**

- `README.md` content becomes `Home.md` (the wiki landing page)
- Each doc file maps to a wiki page named after its slug
- A `_Sidebar.md` is auto-generated with links to all pages in order
- Content hashes track changes — unchanged pages are skipped on sync

## GitHub Actions workflow

The generated workflow enables wiki publishing on push to main:

```yaml
name: Mirror Docs
on:
  push:
    branches: [main]
    paths:
      - 'README.md'
      - 'docs/**'
      - '.docs-mirror.yml'

permissions:
  contents: write

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docs-mirror/docs-mirror@v1
        with:
          config: .docs-mirror.yml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The `contents: write` permission is required to push to the wiki repository.

## CLI flags

```bash
# Enable GitHub Wiki adapter during init
docs-mirror init --github-wiki

# Target a specific repo's wiki
docs-mirror init --github-wiki-repo myorg/docs-wiki

# Override token
docs-mirror sync --github-token ghp_xxx
```

## Verification

Run a dry-run to confirm configuration:

```bash
docs-mirror sync --dry-run --github-wiki
```

## Troubleshooting

### Wiki clone fails

- Ensure the Wiki feature is enabled: **Settings → Features → Wikis**
- Some repos require at least one wiki page to be created via the web UI before the wiki git repo exists. Create a blank page at `https://github.com/owner/repo/wiki/_new` then re-run sync.

### Push rejected (403)

- The token needs push access. In GitHub Actions, ensure `permissions: contents: write`.
- For cross-repo wikis, use a PAT with `repo` scope instead of the default `GITHUB_TOKEN`.

### Pages not appearing

- GitHub Wiki filenames are case-sensitive. Pages are named using the slug from frontmatter.
- Check the wiki at `https://github.com/owner/repo/wiki` after sync completes.

### Token not found

- Set `GITHUB_TOKEN` as an environment variable, in `.env`, or pass `--github-token` on the CLI.
- In GitHub Actions, `${{ github.token }}` or `${{ secrets.GITHUB_TOKEN }}` is available by default.
