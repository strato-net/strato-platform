import { env } from "../env";

export function isS3Available() {
  return env.EXT_STORAGE_ENABLED === 'true'
}
