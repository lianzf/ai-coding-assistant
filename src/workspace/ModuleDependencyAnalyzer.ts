import { posix } from "node:path";
import type { ModuleDependency } from "../domain/project.js";

export interface ModuleSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface ModuleDependencyAnalysis {
  readonly dependencies: readonly ModuleDependency[];
}

const groupedModuleRoots = new Set([
  "apps",
  "extensions",
  "libs",
  "modules",
  "packages",
  "plugins",
  "services",
]);

const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".py", ".ts", ".tsx", ".vue"]);

export function isModuleAnalysisFile(path: string): boolean {
  const normalized = normalize(path);
  return (
    normalized.endsWith("/package.json") ||
    normalized === "package.json" ||
    sourceExtensions.has(posix.extname(normalized).toLocaleLowerCase())
  );
}

export function analyzeModuleDependencies(
  files: readonly ModuleSourceFile[],
): ModuleDependencyAnalysis {
  const normalizedFiles = files.map((file) => ({
    path: normalize(file.path),
    content: file.content,
  }));
  const knownModules = new Set(
    normalizedFiles.map((file) => moduleForPath(file.path)).filter(Boolean),
  );
  const packageModules = packageModuleNames(normalizedFiles);
  const edges = new Map<
    string,
    {
      source: string;
      target: string;
      references: number;
      examples: string[];
    }
  >();

  const addEdge = (source: string, target: string, example: string): void => {
    if (!source || !target || source === target) {
      return;
    }
    const key = `${source}\u0000${target}`;
    const current = edges.get(key) ?? {
      source,
      target,
      references: 0,
      examples: [],
    };
    current.references += 1;
    if (current.examples.length < 3 && !current.examples.includes(example)) {
      current.examples.push(example);
    }
    edges.set(key, current);
  };

  for (const file of normalizedFiles) {
    const source = moduleForPath(file.path);
    if (!source) {
      continue;
    }
    if (posix.basename(file.path).toLocaleLowerCase() === "package.json") {
      for (const dependency of manifestDependencies(file.content)) {
        const target = packageModules.get(dependency);
        if (target) {
          addEdge(source, target, file.path);
        }
      }
      continue;
    }
    const targets = new Set<string>();
    for (const specifier of importSpecifiers(file.path, file.content)) {
      const target = resolveModule(file.path, specifier, knownModules, packageModules);
      if (target) {
        targets.add(target);
      }
    }
    for (const target of targets) {
      addEdge(source, target, file.path);
    }
  }

  return {
    dependencies: [...edges.values()]
      .sort(
        (left, right) =>
          right.references - left.references ||
          left.source.localeCompare(right.source) ||
          left.target.localeCompare(right.target),
      )
      .slice(0, 60),
  };
}

function packageModuleNames(files: readonly ModuleSourceFile[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const file of files) {
    if (posix.basename(file.path).toLocaleLowerCase() !== "package.json") {
      continue;
    }
    try {
      const parsed = JSON.parse(file.content) as unknown;
      if (!isRecord(parsed) || typeof parsed.name !== "string" || !parsed.name.trim()) {
        continue;
      }
      const module = moduleForPath(file.path);
      if (module) {
        names.set(parsed.name.trim(), module);
      }
    } catch {
      // Malformed manifests are ignored by the structural analyzer.
    }
  }
  return names;
}

function manifestDependencies(content: string): readonly string[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return [];
    }
    const names = new Set<string>();
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      const value = parsed[field];
      if (isRecord(value)) {
        for (const name of Object.keys(value)) {
          names.add(name);
        }
      }
    }
    return [...names];
  } catch {
    return [];
  }
}

function importSpecifiers(path: string, content: string): readonly string[] {
  const extension = posix.extname(path).toLocaleLowerCase();
  const specifiers = new Set<string>();
  if (extension === ".py") {
    for (const match of content.matchAll(/^\s*from\s+([.\w]+)\s+import\s+/gm)) {
      if (match[1]) {
        specifiers.add(pythonSpecifier(path, match[1]));
      }
    }
    for (const match of content.matchAll(/^\s*import\s+([\w.]+)/gm)) {
      if (match[1]) {
        specifiers.add(match[1].replaceAll(".", "/"));
      }
    }
    return [...specifiers];
  }
  for (const expression of [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]{0,300}?\s+from\s+)?["']([^"']+)["']/g,
    /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of content.matchAll(expression)) {
      if (match[1]) {
        specifiers.add(match[1]);
      }
    }
  }
  return [...specifiers];
}

function pythonSpecifier(path: string, specifier: string): string {
  const leadingDots = specifier.match(/^\.+/)?.[0].length ?? 0;
  if (leadingDots === 0) {
    return specifier.replaceAll(".", "/");
  }
  let directory = posix.dirname(path);
  for (let index = 1; index < leadingDots; index += 1) {
    directory = posix.dirname(directory);
  }
  return posix.join(directory, specifier.slice(leadingDots).replaceAll(".", "/"));
}

function resolveModule(
  sourcePath: string,
  rawSpecifier: string,
  knownModules: ReadonlySet<string>,
  packageModules: ReadonlyMap<string, string>,
): string | undefined {
  const specifier = rawSpecifier.trim().split(/[?#]/, 1)[0] ?? "";
  if (!specifier) {
    return undefined;
  }
  if (specifier.startsWith(".")) {
    return moduleForPath(posix.normalize(posix.join(posix.dirname(sourcePath), specifier)));
  }
  for (const [packageName, module] of packageModules) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return module;
    }
  }
  const normalized = specifier.replaceAll(".", "/");
  const candidate = moduleForPath(normalized);
  return candidate && knownModules.has(candidate) ? candidate : undefined;
}

function moduleForPath(path: string): string {
  const segments = normalize(path).split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  const first = segments[0] ?? "";
  if (groupedModuleRoots.has(first) && segments[1]) {
    return `${first}/${segments[1]}`;
  }
  if (segments.length === 1) {
    return "(root)";
  }
  return first;
}

function normalize(path: string): string {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
