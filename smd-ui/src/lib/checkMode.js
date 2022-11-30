import { env } from "../env";

export function isOauthEnabled() {
  return env.OAUTH_ENABLED
}