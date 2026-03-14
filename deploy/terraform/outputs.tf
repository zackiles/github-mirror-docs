output "workflow_url" {
  value       = "https://github.com/${var.repository}/actions/workflows/docs-mirror.yml"
  description = "URL of the docs-mirror GitHub Actions workflow"
}

output "secrets_configured" {
  value = compact([
    local.confluence_enabled ? "CONFLUENCE_EMAIL" : "",
    local.confluence_enabled ? "CONFLUENCE_TOKEN" : "",
    local.linear_enabled ? "LINEAR_API_KEY" : "",
  ])
  description = "List of GitHub Actions secrets provisioned"
}
