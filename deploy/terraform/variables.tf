variable "repository" {
  type        = string
  description = "Full repository name (e.g., acme/my-service)"
}

variable "branch" {
  type        = string
  default     = "main"
  description = "Branch to commit config and workflow files to"
}

variable "collection" {
  type        = string
  description = "Default collection name (Confluence Space / Linear Project)"
}

variable "source_include" {
  type        = list(string)
  default     = ["README.md", "docs/**/*.md"]
  description = "Glob patterns for files to sync"
}

variable "source_exclude" {
  type        = list(string)
  default     = []
  description = "Glob patterns to exclude from sync"
}

variable "confluence_url" {
  type        = string
  default     = null
  description = "Confluence base URL (e.g., https://acme.atlassian.net). Set to enable Confluence adapter."
}

variable "confluence_email" {
  type        = string
  default     = null
  sensitive   = true
  description = "Atlassian account email for Confluence API access"
}

variable "confluence_token" {
  type        = string
  default     = null
  sensitive   = true
  description = "Atlassian API token for Confluence"
}

variable "confluence_collection" {
  type        = string
  default     = null
  description = "Override collection name for Confluence adapter"
}

variable "confluence_lock" {
  type        = bool
  default     = true
  description = "Restrict editing on mirrored Confluence pages"
}

variable "linear_api_key" {
  type        = string
  default     = null
  sensitive   = true
  description = "Linear API key. Set to enable Linear adapter."
}

variable "linear_collection" {
  type        = string
  default     = null
  description = "Override collection name for Linear adapter"
}
