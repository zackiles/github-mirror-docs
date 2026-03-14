# Pulumi Module

The Pulumi module provisions docs-mirror for GitHub repositories: it creates the `.docs-mirror.yml` config file, the GitHub Actions workflow, and the required secrets for each adapter.

## Prerequisites

- `@pulumi/github` provider configured with a GitHub token that has repo admin access
- Adapter credentials (Confluence API token, Linear API key) available as Pulumi secrets or config

## Installation

Import the component from the docs-mirror repo:

```typescript
import { DocsMirror } from "docs-mirror/deploy/pulumi"
```

Ensure your Pulumi project has the GitHub provider configured:

```typescript
import * as github from "@pulumi/github"

const provider = new github.Provider("github", {
  token: process.env.GITHUB_TOKEN,
})
```

## Single Repo

```typescript
const mirror = new DocsMirror("my-service", {
  repository: "acme/my-service",
  branch: "main",
  collection: "Engineering Docs",
  adapters: {
    confluence: {
      url: "https://acme.atlassian.net",
      email: pulumi.secret("you@acme.com"),
      token: pulumi.secret("your-atlassian-token"),
    },
    linear: {
      apiKey: pulumi.secret("lin_api_..."),
    },
  },
  source: {
    include: ["README.md", "docs/**/*.md"],
    exclude: [],
  },
})

export const workflowUrl = mirror.workflowUrl
export const secretNames = mirror.secretNames
```

## Fleet Rollout

```typescript
const repos = ["acme/service-a", "acme/service-b", "acme/service-c"]

for (const repo of repos) {
  new DocsMirror(repo.split("/")[1], {
    repository: repo,
    collection: "Engineering Docs",
    adapters: {
      confluence: {
        url: "https://acme.atlassian.net",
        email: confluenceEmailSecret,
        token: confluenceTokenSecret,
      },
    },
  })
}
```

## What Gets Provisioned

| Resource | Purpose |
|----------|---------|
| `.docs-mirror.yml` | Mirror configuration (collection, source paths, adapters) |
| `.github/workflows/docs-mirror.yml` | GitHub Actions workflow that runs sync on push |
| GitHub Actions secrets | `CONFLUENCE_EMAIL`, `CONFLUENCE_TOKEN`, `LINEAR_API_KEY` (per adapter) |

## Outputs

| Output | Description |
|--------|-------------|
| `workflowUrl` | URL of the docs-mirror workflow in the repository |
| `secretNames` | List of GitHub Actions secret names provisioned |

## Removal

Remove the `DocsMirror` resource from your stack and run `pulumi up`. The workflow file, config file, and secrets are deleted. Frontmatter in markdown files is not managed by IaC and is left unchanged.
