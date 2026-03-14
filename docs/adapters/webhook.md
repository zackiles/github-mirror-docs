# Webhook / Custom CMS Setup

The webhook adapter lets you mirror documentation to any CMS or platform that exposes an HTTP API. You define endpoints, auth, and response parsing in a YAML template.

## When to use it

Use the webhook adapter when:

- You need to sync to WordPress, Ghost, Drupal, or another CMS not built-in
- You have a custom documentation platform with a REST API
- You want to push to multiple custom targets with different configurations

## Setup

1. Copy `templates/webhook.yml` into your repo (e.g. `.docs-mirror-webhook.yml`)
2. Fill out auth, endpoints, and response paths for your API
3. Reference the template in `.docs-mirror.yml`:

```yaml
mirrors:
  - adapter: webhook
    template: .docs-mirror-webhook.yml
    collection: Engineering Docs
    banner: true
```

## Auth methods

Credentials come from environment variables. Never put secrets in the template file.

| Method | Env vars | Description |
|--------|----------|-------------|
| `bearer` | `token_env` (default: `WEBHOOK_TOKEN`) | `Authorization: Bearer <token>` |
| `basic` | `username_env`, `password_env` (default: `WEBHOOK_USERNAME`, `WEBHOOK_PASSWORD`) | `Authorization: Basic base64(user:pass)` |
| `header` | `header_name` (default: `X-API-Key`), `header_value_env` (default: `WEBHOOK_API_KEY`) | Custom header |
| `none` | — | No auth (internal or localhost APIs) |

Example for bearer:

```yaml
auth:
  method: bearer
  token_env: WORDPRESS_APP_PASSWORD
```

## Content format

| Value | Description |
|-------|-------------|
| `markdown` | Send raw markdown. Use for Linear-style APIs, Ghost, Dev.to. |
| `html` | Convert markdown to HTML before sending. Use for WordPress, Drupal. |

## Endpoint configuration

Each endpoint supports `method`, `url`, and optionally `body`. URLs and body templates use placeholders:

| Placeholder | Description |
|-------------|-------------|
| `{collection}` | Collection name from config or frontmatter |
| `{slug}` | Page slug |
| `{title}` | Page title |
| `{content}` | Page body (markdown or HTML) |
| `{parent}` | Parent slug, or empty |
| `{tags}` | JSON array of tags |
| `{page_id}` | Resolved from get_page response (for update_page) |

Example:

```yaml
endpoints:
  get_page:
    method: GET
    url: https://cms.example.com/api/pages?slug={slug}&space={collection}
  create_page:
    method: POST
    url: https://cms.example.com/api/pages
    body: |
      {
        "title": "{title}",
        "slug": "{slug}",
        "body": "{content}",
        "meta": { "collection": "{collection}" }
      }
  update_page:
    method: PUT
    url: https://cms.example.com/api/pages/{page_id}
    body: |
      {
        "title": "{title}",
        "body": "{content}"
      }
```

If your CMS uses a single upsert endpoint, set the same URL for both `create_page` and `update_page`.

## Response parsing

Tell docs-mirror where to find the resource ID and URL in JSON responses. Use dot notation:

```yaml
response:
  id_path: id
  url_path: url
```

For nested responses:

```yaml
response:
  id_path: data.id
  url_path: data.permalink
```

## Worked examples

### WordPress REST API

```yaml
auth:
  method: basic
  username_env: WP_USER
  password_env: WP_APP_PASSWORD

content_format: html

endpoints:
  get_collection:
    method: GET
    url: https://yoursite.com/wp-json/wp/v2/users/me
  get_page:
    method: GET
    url: https://yoursite.com/wp-json/wp/v2/pages?slug={slug}
  create_page:
    method: POST
    url: https://yoursite.com/wp-json/wp/v2/pages
    body: |
      {"title":"{title}","content":"{content}","status":"publish"}
  update_page:
    method: POST
    url: https://yoursite.com/wp-json/wp/v2/pages/{page_id}
    body: |
      {"title":"{title}","content":"{content}"}

response:
  id_path: id
  url_path: link

banner: true
```

Use an Application Password (Users → Profile → Application Passwords). The slug query returns an array; if so, use `id_path: "0.id"` and `url_path: "0.link"`. Create/update return single objects with `id` and `link`, so you may need a custom endpoint or proxy if get_page has a different response shape.

### Ghost Admin API

```yaml
auth:
  method: header
  header_name: Authorization
  header_value_env: GHOST_ADMIN_KEY

content_format: html

endpoints:
  get_page:
    method: GET
    url: https://your-ghost.com/ghost/api/admin/pages/slug/{slug}/
  create_page:
    method: POST
    url: https://your-ghost.com/ghost/api/admin/pages/
    body: |
      {"pages":[{"title":"{title}","html":"{content}"}]}
  update_page:
    method: PUT
    url: https://your-ghost.com/ghost/api/admin/pages/{page_id}/
    body: |
      {"pages":[{"title":"{title}","html":"{content}"}]}

response:
  id_path: pages.0.id
  url_path: pages.0.url

banner: true
```

Ghost returns `{ pages: [{ id, url, ... }] }`; adjust `id_path` and `url_path` to match.

## Testing

Run a dry-run to validate the template and auth:

```bash
npx docs-mirror sync --dry-run --adapter webhook
```

This loads the template, resolves auth, and optionally calls `get_collection` to verify credentials. No pages are created or updated.

## Debugging

Use `--verbose` for more output:

```bash
npx docs-mirror sync --adapter webhook --verbose
```

Verbose mode can help diagnose failed requests and response parsing.

## Banner configuration

When `banner: true` (default in config), a "Mirrored from GitHub" block is prepended to each page. For `content_format: markdown` it is a markdown blockquote; for `html` it is an HTML div. Set `banner: false` in the mirror config or template to disable.
