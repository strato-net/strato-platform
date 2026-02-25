export const getEnv = (name: string): string | undefined => process.env[name];

export const getNumberEnvOrDefault = (name: string, defaultValue: number): number =>
  Number(getEnv(name)) || defaultValue;

export const getBigIntEnvOrDefault = (name: string, defaultValue: string): bigint =>
  BigInt(getEnv(name) || defaultValue);

export const getMissingRequiredEnvVars = (requiredEnvVars: readonly string[]): string[] =>
  requiredEnvVars.filter((envVar) => !getEnv(envVar));

export const validateRequiredEnvVars = (requiredEnvVars: readonly string[]): void => {
  const missingEnvVars = getMissingRequiredEnvVars(requiredEnvVars);
  if (missingEnvVars.length === 0) {
    return;
  }

  const error = `Missing required environment variables when initializing the config: ${missingEnvVars.join(", ")}`;
  console.error(error);
  process.exit(2);
};
