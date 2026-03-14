# docs-mirror Pulumi Module

Provision docs-mirror across GitHub repositories using Pulumi.

## Usage

```typescript
import { DocsMirror } from "docs-mirror/deploy/pulumi";

const mirror = new DocsMirror("my-service", {
  repository: "acme/my-service",
  branch: "main",
  collection: "Engineering Docs",
  adapters: {
    confluence: {
      url: "https://acme.atlassian.net",
      email: confluenceEmailSecret,
      token: confluenceTokenSecret,
    },
    linear: {
      apiKey: linearKeySecret,
    },
  },
  source: {
    include: ["README.md", "docs/**/*.md"],
  },
});

export const workflowUrl = mirror.workflowUrl;
```

## Fleet Rollout

```typescript
const repos = ["acme/service-a", "acme/service-b", "acme/service-c"];

for (const repo of repos) {
  new DocsMirror(repo.split("/")[1], {
    repository: repo,
    collection: "Engineering Docs",
    adapters: {
      confluence: { url: "https://acme.atlassian.net", email, token },
    },
  });
}
```

## What Gets Provisioned

| Resource | Purpose |
|---|---|
| `.github/workflows/docs-mirror.yml` | GitHub Actions workflow file |
| `.docs-mirror.yml` | Mirror configuration file |
| GitHub Actions secrets | Credentials for each configured adapter |

## Removal

Remove the `DocsMirror` resource from your stack and run `pulumi up`. The workflow file, config file, and secrets are all deleted. Frontmatter in markdown files is unaffected.

## Prerequisites

- `@pulumi/github` provider configured with a GitHub token that has repo admin access
- Adapter credentials (Confluence API token, Linear API key)
