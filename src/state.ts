import { resolve } from "@std/path"

export interface ResourceEntry {
  id: string
  slug: string
  hash: string
}

export interface StateData {
  version: number
  resources: Record<string, Record<string, ResourceEntry>>
}

export interface Rename {
  from: string
  to: string
  entry: ResourceEntry
}

const STATE_FILE = ".docs-mirror-state.json"

export function statePath(cwd: string): string {
  return resolve(cwd, STATE_FILE)
}

export async function load(cwd: string): Promise<StateData> {
  try {
    const text = await Deno.readTextFile(statePath(cwd))
    const data = JSON.parse(text) as StateData
    if (data.version !== 1) return empty()
    return data
  } catch {
    return empty()
  }
}

export async function save(cwd: string, state: StateData): Promise<void> {
  const json = JSON.stringify(state, null, 2) + "\n"
  await Deno.writeTextFile(statePath(cwd), json)
}

export function empty(): StateData {
  return { version: 1, resources: {} }
}

export function detectRenames(
  state: StateData,
  adapter: string,
  currentPaths: string[],
): Rename[] {
  const tracked = state.resources[adapter]
  if (!tracked) return []

  const currentSet = new Set(currentPaths)
  const removed = Object.entries(tracked).filter(([path]) => !currentSet.has(path))
  if (removed.length === 0) return []

  const trackedPaths = new Set(Object.keys(tracked))
  const added = currentPaths.filter((p) => !trackedPaths.has(p))
  if (added.length === 0) return []

  const renames: Rename[] = []
  const gitRenames = detectGitRenames(removed.map(([p]) => p))

  for (const [oldPath, entry] of removed) {
    const gitTarget = gitRenames.get(oldPath)
    if (gitTarget && added.includes(gitTarget)) {
      renames.push({ from: oldPath, to: gitTarget, entry })
      continue
    }
  }

  return renames
}

function detectGitRenames(removedPaths: string[]): Map<string, string> {
  const renames = new Map<string, string>()
  try {
    const cmd = new Deno.Command("git", {
      args: ["diff", "--name-status", "--find-renames", "HEAD~1", "HEAD"],
      stdout: "piped",
      stderr: "null",
    })
    const output = cmd.outputSync()
    if (!output.success) return renames

    const lines = new TextDecoder().decode(output.stdout).trim().split("\n")
    const removedSet = new Set(removedPaths)

    for (const line of lines) {
      const match = line.match(/^R\d*\t(.+)\t(.+)$/)
      if (match && removedSet.has(match[1])) {
        renames.set(match[1], match[2])
      }
    }
  } catch {
    // git not available or no previous commit
  }
  return renames
}

export function update(
  state: StateData,
  adapter: string,
  path: string,
  entry: ResourceEntry,
): void {
  if (!state.resources[adapter]) {
    state.resources[adapter] = {}
  }
  state.resources[adapter][path] = entry
}

export function remove(state: StateData, adapter: string, path: string): void {
  if (state.resources[adapter]) {
    delete state.resources[adapter][path]
  }
}

export function lookup(
  state: StateData,
  adapter: string,
  path: string,
): ResourceEntry | undefined {
  return state.resources[adapter]?.[path]
}
