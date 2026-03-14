# Frontmatter Reference

docs-mirror uses YAML frontmatter in markdown files to control which pages are mirrored, where they go, and how they are ordered. Frontmatter lives at the top of each file between `---` delimiters.

## Why frontmatter

Frontmatter lets you:

- Override auto-generated titles and slugs
- Exclude files from mirroring (`publish: false`)
- Assign pages to different collections (Confluence Spaces, Linear Projects)
- Nest pages under parents
- Control sort order
- Add tags

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
| `title` | Yes (auto) | From H1 or filename | Page title. Auto-generated if omitted. |
| `publish` | No | `true` | Set to `false` to exclude from mirroring. |
| `collection` | No | Config default | Overrides the config collection for this file. |
| `parent` | No | — | Slug of parent page for nesting. |
| `tags` | No | `[]` | Array of tags. Merged with config defaults. |
| `order` | No | `999` | Numeric sort order (lower first). |
| `slug` | No (auto) | From title | URL-safe identifier. Auto-generated if omitted. |

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
