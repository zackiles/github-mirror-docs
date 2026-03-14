import * as pulumi from "@pulumi/pulumi"
import * as github from "@pulumi/github"

export interface AdapterConfig {
  confluence?: {
    url: string
    email: pulumi.Input<string>
    token: pulumi.Input<string>
    collection?: string
    lock?: boolean
  }
  linear?: {
    apiKey: pulumi.Input<string>
    collection?: string
  }
}

export interface DocsMirrorArgs {
  repository: string
  branch?: string
  collection: string
  adapters: AdapterConfig
  source?: {
    include?: string[]
    exclude?: string[]
  }
}

export class DocsMirror extends pulumi.ComponentResource {
  public readonly workflowUrl: pulumi.Output<string>
  public readonly secretNames: pulumi.Output<string[]>

  constructor(name: string, args: DocsMirrorArgs, opts?: pulumi.ComponentResourceOptions) {
    super("docs-mirror:index:DocsMirror", name, {}, opts)

    const [owner, repo] = args.repository.split("/")
    const branch = args.branch ?? "main"

    const configContent = buildConfig(args)
    const workflowContent = buildWorkflow(args)

    const configFile = new github.RepositoryFile(
      `${name}-config`,
      {
        repository: repo,
        file: ".docs-mirror.yml",
        content: configContent,
        branch,
        commitMessage: "chore: configure docs-mirror",
        overwriteOnCreate: true,
      },
      { parent: this },
    )

    const workflowFile = new github.RepositoryFile(
      `${name}-workflow`,
      {
        repository: repo,
        file: ".github/workflows/docs-mirror.yml",
        content: workflowContent,
        branch,
        commitMessage: "chore: add docs-mirror workflow",
        overwriteOnCreate: true,
      },
      { parent: this },
    )

    const secrets: string[] = []

    if (args.adapters.confluence) {
      new github.ActionsSecret(
        `${name}-confluence-email`,
        {
          repository: repo,
          secretName: "CONFLUENCE_EMAIL",
          plaintextValue: args.adapters.confluence.email,
        },
        { parent: this },
      )
      new github.ActionsSecret(
        `${name}-confluence-token`,
        {
          repository: repo,
          secretName: "CONFLUENCE_TOKEN",
          plaintextValue: args.adapters.confluence.token,
        },
        { parent: this },
      )
      secrets.push("CONFLUENCE_EMAIL", "CONFLUENCE_TOKEN")
    }

    if (args.adapters.linear) {
      new github.ActionsSecret(
        `${name}-linear-key`,
        {
          repository: repo,
          secretName: "LINEAR_API_KEY",
          plaintextValue: args.adapters.linear.apiKey,
        },
        { parent: this },
      )
      secrets.push("LINEAR_API_KEY")
    }

    this.workflowUrl = pulumi.interpolate`https://github.com/${owner}/${repo}/actions/workflows/docs-mirror.yml`
    this.secretNames = pulumi.output(secrets)

    this.registerOutputs({
      workflowUrl: this.workflowUrl,
      secretNames: this.secretNames,
    })
  }
}

function buildConfig(args: DocsMirrorArgs): string {
  const mirrors: Record<string, unknown>[] = []

  if (args.adapters.confluence) {
    const m: Record<string, unknown> = {
      adapter: "confluence",
      url: args.adapters.confluence.url,
    }
    if (args.adapters.confluence.collection) m.collection = args.adapters.confluence.collection
    if (args.adapters.confluence.lock === false) m.lock = false
    mirrors.push(m)
  }

  if (args.adapters.linear) {
    const m: Record<string, unknown> = { adapter: "linear" }
    if (args.adapters.linear.collection) m.collection = args.adapters.linear.collection
    mirrors.push(m)
  }

  const config: Record<string, unknown> = {
    collection: args.collection,
    mirrors,
  }

  if (args.source) {
    config.source = {
      include: args.source.include ?? ["README.md", "docs/**/*.md"],
      exclude: args.source.exclude ?? [],
    }
  }

  return yamlStringify(config)
}

function buildWorkflow(args: DocsMirrorArgs): string {
  const secrets: string[] = []
  if (args.adapters.confluence) {
    secrets.push(
      "          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}",
      "          CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}",
    )
  }
  if (args.adapters.linear) {
    secrets.push("          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}")
  }

  return `name: Mirror Docs
on:
  push:
    branches: [${args.branch ?? "main"}]
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
${secrets.join("\n")}
`
}

function yamlStringify(obj: Record<string, unknown>, indent = 0): string {
  const pad = "  ".repeat(indent)
  const lines: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`)
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          const entries = Object.entries(item as Record<string, unknown>)
          lines.push(`${pad}  - ${entries[0][0]}: ${formatValue(entries[0][1])}`)
          for (const [k, v] of entries.slice(1)) {
            lines.push(`${pad}    ${k}: ${formatValue(v)}`)
          }
        } else {
          lines.push(`${pad}  - ${formatValue(item)}`)
        }
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${pad}${key}:`)
      lines.push(yamlStringify(value as Record<string, unknown>, indent + 1))
    } else {
      lines.push(`${pad}${key}: ${formatValue(value)}`)
    }
  }

  return lines.join("\n")
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value.includes(":") || value.includes("#") ? `"${value}"` : value
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  return String(value)
}
