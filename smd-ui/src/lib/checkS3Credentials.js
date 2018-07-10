import { env } from "../env";

export function isS3Available() {
  return Boolean(env.S3_CREDENTIALS)
}