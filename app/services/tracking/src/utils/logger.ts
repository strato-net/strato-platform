export const logInfo = (component: string, message: string, meta?: object) => {
  console.log(`[${component}] ${message}`, meta ? JSON.stringify(meta) : "");
};

export const logError = (component: string, error: Error | unknown, meta?: object) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${component}] ${message}`, meta ? JSON.stringify(meta) : "");
};
