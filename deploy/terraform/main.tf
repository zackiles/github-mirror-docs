terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

locals {
  repo_parts = split("/", var.repository)
  owner      = local.repo_parts[0]
  repo       = local.repo_parts[1]

  confluence_enabled = var.confluence_url != null
  linear_enabled     = var.linear_api_key != null

  mirrors = concat(
    local.confluence_enabled ? [merge(
      {
        adapter = "confluence"
        url     = var.confluence_url
      },
      var.confluence_collection != null ? { collection = var.confluence_collection } : {},
      var.confluence_lock == false ? { lock = false } : {},
    )] : [],
    local.linear_enabled ? [merge(
      { adapter = "linear" },
      var.linear_collection != null ? { collection = var.linear_collection } : {},
    )] : [],
  )

  config_yaml = yamlencode({
    collection = var.collection
    source = {
      include = var.source_include
      exclude = var.source_exclude
    }
    mirrors = local.mirrors
  })

  secrets_env = concat(
    local.confluence_enabled ? [
      "          CONFLUENCE_EMAIL: $${{{ secrets.CONFLUENCE_EMAIL }}}",
      "          CONFLUENCE_TOKEN: $${{{ secrets.CONFLUENCE_TOKEN }}}",
    ] : [],
    local.linear_enabled ? [
      "          LINEAR_API_KEY: $${{{ secrets.LINEAR_API_KEY }}}",
    ] : [],
  )

  workflow_yaml = <<-EOT
name: Mirror Docs
on:
  push:
    branches: [${var.branch}]
    paths:
      - 'README.md'
      - 'docs/**'
      - '.docs-mirror.yml'

permissions:
  contents: read

concurrency:
  group: docs-mirror
  cancel-in-progress: true

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docs-mirror/docs-mirror@v1
        with:
          config: .docs-mirror.yml
        env:
${join("\n", local.secrets_env)}
EOT
}

resource "github_repository_file" "config" {
  repository          = local.repo
  file                = ".docs-mirror.yml"
  content             = local.config_yaml
  branch              = var.branch
  commit_message      = "chore: configure docs-mirror"
  overwrite_on_create = true
}

resource "github_repository_file" "workflow" {
  repository          = local.repo
  file                = ".github/workflows/docs-mirror.yml"
  content             = local.workflow_yaml
  branch              = var.branch
  commit_message      = "chore: add docs-mirror workflow"
  overwrite_on_create = true
}

resource "github_actions_secret" "confluence_email" {
  count           = local.confluence_enabled && var.confluence_email != null ? 1 : 0
  repository      = local.repo
  secret_name     = "CONFLUENCE_EMAIL"
  plaintext_value = var.confluence_email
}

resource "github_actions_secret" "confluence_token" {
  count           = local.confluence_enabled && var.confluence_token != null ? 1 : 0
  repository      = local.repo
  secret_name     = "CONFLUENCE_TOKEN"
  plaintext_value = var.confluence_token
}

resource "github_actions_secret" "linear_api_key" {
  count           = local.linear_enabled ? 1 : 0
  repository      = local.repo
  secret_name     = "LINEAR_API_KEY"
  plaintext_value = var.linear_api_key
}
