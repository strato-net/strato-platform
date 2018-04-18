import { env } from "../env";

export function isModePublic() {
  return env.SMD_MODE === 'public'
}