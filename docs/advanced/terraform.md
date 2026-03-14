# Terraform Module

The Terraform module provisions docs-mirror for GitHub repositories: it creates the `.docs-mirror.yml` config file, the GitHub Actions workflow, and the required secrets for each adapter.

## Prerequisites

- `integrations/github` provider configured with a GitHub token that has repo admin access
- Adapter credentials (Confluence API token, Linear API key) available as Terraform variables or from a secrets backend

## Single Repo

```hcl
module "docs_mirror" {
  source = "github.com/docs-mirror/docs-mirror//deploy/terraform"

  repository = "acme/my-service"
  branch     = "main"
  collection = "Engineering Docs"

  confluence_url   = "https://acme.atlassian.net"
  confluence_email = var.confluence_email
  confluence_token = var.confluence_token
  linear_api_key   = var.linear_api_key

  source_include = ["README.md", "docs/**/*.md"]
}

output "workflow_url" {
  value = module.docs_mirror.workflow_url
}
```

## Fleet Rollout

```hcl
variable "repositories" {
  type    = list(string)
  default = ["acme/service-a", "acme/service-b", "acme/service-c"]
}

module "docs_mirror" {
  for_each   = toset(var.repositories)
  source     = "github.com/docs-mirror/docs-mirror//deploy/terraform"
  repository = each.value
  collection = "Engineering Docs"

  confluence_url   = var.confluence_url
  confluence_email = var.confluence_email
  confluence_token = var.confluence_token
  linear_api_key   = var.linear_api_key
}
```

## Variables Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `repository` | string | — | Full repository name (e.g. `acme/my-service`) |
| `branch` | string | `"main"` | Branch to commit config and workflow files to |
| `collection` | string | — | Default collection name (Confluence Space / Linear Project) |
| `source_include` | list(string) | `["README.md", "docs/**/*.md"]` | Glob patterns for files to sync |
| `source_exclude` | list(string) | `[]` | Glob patterns to exclude from sync |
| `confluence_url` | string | `null` | Confluence base URL. Set to enable Confluence adapter. |
| `confluence_email` | string | `null` | Atlassian account email for Confluence API access |
| `confluence_token` | string | `null` | Atlassian API token for Confluence |
| `confluence_collection` | string | `null` | Override collection name for Confluence adapter |
| `confluence_lock` | bool | `true` | Restrict editing on mirrored Confluence pages |
| `linear_api_key` | string | `null` | Linear API key. Set to enable Linear adapter. |
| `linear_collection` | string | `null` | Override collection name for Linear adapter |

## Outputs

| Output | Description |
|--------|-------------|
| `workflow_url` | URL of the docs-mirror GitHub Actions workflow |
| `secrets_configured` | List of GitHub Actions secret names provisioned |

## Removal

Remove the module from your configuration and run `terraform apply`. The workflow file, config file, and secrets are deleted. Frontmatter in markdown files is not managed by IaC and is left unchanged.
