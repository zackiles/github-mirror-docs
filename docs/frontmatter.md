# Frontmatter Reference

docs-mirror uses YAML frontmatter in markdown files to control which pages are mirrored, where they go, and how they are ordered. Frontmatter lives at the top of each file between `---` delimiters.

All fields are optional. docs-mirror follows **convention over configuration** — without any frontmatter at all, titles come from H1 headings, hierarchy comes from directory structure, and README.md files act as section index pages.

## Hierarchy conventions

docs-mirror infers page hierarchy from your file and folder structure:

- **`README.md`** at the repository root becomes the **root page** in the mirror. Its content fills the top-level page that all other docs nest under. Its H1 heading (or frontmatter `title`) becomes the root page title.
- **`docs/setup.md`** becomes a child of the root page.
- **`docs/api/README.md`** becomes a section page — a child of the root page and the parent of everything else in `docs/api/`.
- **`docs/api/endpoints.md`** becomes a child of `docs/api/README.md`.
- If a directory has no README.md, its files become children of the nearest ancestor README (or the root page).

This means a typical repository layout:

```
README.md
docs/
  getting-started.md
  configuration.md
  api/
    README.md
    endpoints.md
    authentication.md
  advanced/
    pulumi.md
    terraform.md
```

Produces this hierarchy in the mirror:

```
My Service (from README.md)
  ├── Getting Started
  ├── Configuration
  ├── API (from docs/api/README.md)
  │   ├── Endpoints
  │   └── Authentication
  ├── Pulumi
  └── Terraform
```

No frontmatter is required for this to work.

## Example

```yaml
---
title: API Reference
publish: true
collection: Engineering Docs
parent: getting-started
tags:
  - api
  - reference
order: 20
slug: api-reference
---
# API Reference

Content here...
```

## Field reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `title` | No | From H1 or filename | Page title. Auto-generated if omitted. |
| `publish` | No | `true` | Set to `false` to exclude from mirroring. |
| `collection` | No | Config default | Overrides the config collection for this file. |
| `parent` | No | Inferred from directory | Slug of parent page. Set to `false` to place at the collection root with no parent. |
| `tags` | No | `[]` | Array of tags. Merged with config defaults. |
| `order` | No | `999` | Numeric sort order among siblings (lower first). |
| `slug` | No | From title | URL-safe identifier. Auto-generated if omitted. |

## Parent field

The `parent` field has three modes:

| Value | Behavior |
|-------|----------|
| *(omitted)* | Parent is inferred from directory structure. Files nest under the README.md of their directory, or the nearest ancestor README, or the root page. |
| `parent: "api-reference"` | Explicit override. The page becomes a child of the page with slug `api-reference`. |
| `parent: false` | Opt out of auto-nesting. The page is placed at the collection root (Confluence space root, etc.) with no parent. |

## Auto-generation

### Title

Resolved in order:

1. Explicit `title` in frontmatter
2. First H1 heading in the body (`# Heading`)
3. Filename with `.md` stripped, `-` and `_` replaced by spaces, words capitalized

Examples:

- `docs/getting-started.md` with no H1 → "Getting Started"
- `docs/api_reference.md` with no H1 → "Api Reference"
- File with `# Quick Start` as first line → "Quick Start"

### Slug

Resolved in order:

1. Explicit `slug` in frontmatter
2. Slugified title: lowercase, non-alphanumeric replaced by `-`, leading/trailing hyphens removed

Example: "API Reference" → `api-reference`

## Merge behavior on init

When you run `docs-mirror init` on files that already have frontmatter:

- Existing fields are kept
- Only missing fields are added (title, slug, publish, collection)
- Init never overwrites values you have set

So if a file already has `title: Custom Title`, init will not change it. If it has no `collection`, init adds the default collection you chose.
