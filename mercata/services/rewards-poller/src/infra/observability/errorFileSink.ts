import { promises as fs } from "fs";
import path from "path";
import { ERROR_FILE_NAME } from "../config/runtimeConfig";

const ERROR_FILE_PATH = path.join(process.cwd(), ERROR_FILE_NAME);

type ErrorWithCode = { code?: unknown };

export const appendErrorRecord = async (
  errorData: string | object,
): Promise<string> => {
  const errorJsonString = JSON.stringify({
    timestamp: new Date().toISOString(),
    error: errorData,
  });

  await fs.appendFile(ERROR_FILE_PATH, `${errorJsonString}\n`);
  return errorJsonString;
};

export const errorFileHasContent = async (): Promise<boolean> => {
  const stats = await fs.stat(ERROR_FILE_PATH);
  return stats.size > 0;
};

export const isMissingErrorFile = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      (error as ErrorWithCode).code === "ENOENT",
  );
