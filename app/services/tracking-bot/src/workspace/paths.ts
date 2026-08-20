import path from "path";

// Minimal glob matcher: ** (any depth), * (within a segment), ? (one char).
// Patterns and paths are repo-relative with forward slashes.
const globToRegExp = (glob: string): RegExp => {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // "**/" matches zero or more directories; trailing "**" matches everything
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(re + "$");
};

const compiled = new Map<string, RegExp>();
const regexFor = (glob: string): RegExp => {
  let re = compiled.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    compiled.set(glob, re);
  }
  return re;
};

export const matchesAny = (relPath: string, globs: string[]): boolean => {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return globs.some((g) => regexFor(g).test(normalized));
};

// Resolve a user-supplied path against the repo root and refuse escapes.
export const resolveInside = (root: string, relPath: string): { abs: string; rel: string } => {
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path "${relPath}" is outside the repository`);
  }
  return { abs, rel };
};
