import { env } from "../env";

export function isModePublic() {
  return env.SMD_MODE === 'public'
}

export function isModeOauth() {
  return env.SMD_MODE === 'oauth'
}

export function isOauthEnabled() {
  return env.OAUTH_ENABLED
}