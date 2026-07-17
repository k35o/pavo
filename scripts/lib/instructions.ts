// Instruction resolution: dependency graph from instructions/index.json,
// plus `./`-prefixed entries resolved against the target repo workspace so
// callers can keep their own viewpoint files without forking Pavo.

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param actionPath pavo repo checkout
 * @param requested comma-separated names / `./` workspace paths
 * @returns absolute file paths in load order, duplicates removed
 */
export function resolveInstructionFiles(
  actionPath: string,
  requested: string,
  { workspace }: { workspace?: string | null } = {},
): string[] {
  const manifestPath = path.join(actionPath, 'instructions', 'index.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, string[]>;
  const seen = new Set<string>();
  const files: string[] = [];

  const visit = (raw: string, stack: string[]): void => {
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    if (stack.includes(name)) {
      throw new Error(`Circular instruction dependency: ${[...stack, name].join(' -> ')}`);
    }

    if (name.startsWith('./')) {
      if (!workspace) {
        throw new Error(`Workspace-relative instruction requires a checkout: ${name}`);
      }
      const file = path.resolve(workspace, name);
      if (!file.startsWith(path.resolve(workspace) + path.sep)) {
        throw new Error(`Instruction path escapes the workspace: ${name}`);
      }
      if (!fs.existsSync(file)) {
        throw new Error(`Workspace instruction not found: ${name}`);
      }
      // A symlink inside the workspace can still point outside it.
      const realFile = fs.realpathSync(file);
      const realWorkspace = fs.realpathSync(path.resolve(workspace));
      if (!realFile.startsWith(realWorkspace + path.sep)) {
        throw new Error(`Instruction path escapes the workspace (symlink): ${name}`);
      }
      seen.add(name);
      files.push(file);
      return;
    }

    // A typo'd name silently reviewing with fewer viewpoints is worse than a
    // red run, so unknown names and missing files are hard errors.
    if (!Object.hasOwn(manifest, name)) {
      throw new Error(`Unknown instruction: ${name} (known: ${Object.keys(manifest).join(', ')})`);
    }
    for (const dep of manifest[name] ?? []) {
      visit(dep, [...stack, name]);
    }
    const file = path.join(actionPath, 'instructions', `${name}.md`);
    if (!fs.existsSync(file)) {
      throw new Error(`Instruction file missing for "${name}": ${file}`);
    }
    seen.add(name);
    files.push(file);
  };

  for (const raw of requested.split(',')) {
    visit(raw, []);
  }
  return files;
}
