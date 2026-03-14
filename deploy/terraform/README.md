# docs-mirror Terraform Module

Provision docs-mirror across GitHub repositories using Terraform.

## Usage

```hcl
module "docs_mirror" {
  source     = "github.com/docs-mirror/docs-mirror//deploy/terraform"

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

## What Gets Provisioned

| Resource | Purpose |
|---|---|
| `.github/workflows/docs-mirror.yml` | GitHub Actions workflow file |
| `.docs-mirror.yml` | Mirror configuration file |
| GitHub Actions secrets | Credentials for each configured adapter |

## Removal

Remove the module from your configuration and run `terraform apply`. The workflow file, config file, and secrets are all deleted. Frontmatter in markdown files is unaffected.

## Prerequisites

- GitHub provider configured with a token that has repo admin access
- Adapter credentials (Confluence API token, Linear API key)
