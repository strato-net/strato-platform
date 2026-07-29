import * as fs from "fs";
import * as path from "path";

export const cwd = path.resolve(process.cwd());
let nameStore: string[] = [];

export function combine(
  filename: string,
  relativePath?: string
): Promise<Record<string, string>> {
  nameStore = [];

  const result = readFileLinesToObject({}, filename, relativePath);
  return Promise.resolve(result);
}

function readFileLinesToObject(
  fileMap: Record<string, string>,
  fullname: string,
  relativePath?: string
): Record<string, string> {
  const lines = fs.readFileSync(fullname, "utf-8").split("\n");
  isImported(fullname);

  const { fileMap: updatedMap, buffer } = lines.reduce(
    ({ fileMap, buffer }, line) => {
      if (line.startsWith("import") && !line.includes("<")) {
        const newBuffer = buffer + "//" + line + "\n";
        const newFileMap = importFileToObject(fileMap, fullname, relativePath, line);
        return { fileMap: newFileMap, buffer: newBuffer };
      } else {
        const fixedLine = line.replace("\r", " ");
        return { fileMap, buffer: buffer + fixedLine + "\n" };
      }
    },
    { fileMap, buffer: "" }
  );

  return { ...updatedMap, [getShortName(fullname)]: buffer };
}

function importFileToObject(
  fileMap: Record<string, string>,
  fullname: string,
  relativePath: string | undefined,
  line: string
): Record<string, string> {
  let importName = line
    .replace(/import[\s]+/i, "")
    .replace(/\"/g, "")
    .replace(";", "")
    .replace("\r", "");

  if (isImported(importName)) return fileMap;

  const basePath = importName.startsWith("/")
    ? path.join(relativePath || cwd, importName)
    : path.join(splitPath(fullname), importName);

  return readFileLinesToObject(fileMap, basePath, relativePath);
}

function isImported(fullname: string): boolean {
  const name = getShortName(fullname);
  if (nameStore.includes(name)) return true;
  nameStore.push(name);
  return false;
}

function getShortName(fullname: string): string {
  const segments = fullname.split(path.sep).length <= 1
    ? fullname.split("/")
    : fullname.split(path.sep);
  return segments.pop()!;
}

function splitPath(fullname: string): string {
  const segments = fullname.split(path.sep).length <= 1
    ? fullname.split("/")
    : fullname.split(path.sep);
  return segments.slice(0, -1).join(path.sep);
}

export function usc(args: Record<string, any>): Record<string, any> {
  return Object.keys(args).reduce((acc: Record<string, any>, key: string) => {
    acc[`_${key}`] = args[key];
    return acc;
  }, {});
}