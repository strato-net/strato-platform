// The format string is constant: a message can carry outside text (a
// database or HTTP error), which must not be read as format directives.
export const logInfo = (component: string, message: string, meta?: object) => {
  console.log("[%s] %s", component, message, meta ? JSON.stringify(meta) : "");
};

export const logWarn = (component: string, message: string, meta?: object) => {
  console.warn("[%s] %s", component, message, meta ? JSON.stringify(meta) : "");
};

export const logError = (component: string, error: Error | unknown, meta?: object) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[%s] %s", component, message, meta ? JSON.stringify(meta) : "");
};
