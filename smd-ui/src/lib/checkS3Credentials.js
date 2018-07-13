import { env } from "../env";

export function isS3Available() {
  return env.S3_CREDENTIALS
}
