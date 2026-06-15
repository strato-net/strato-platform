import { env } from "../env";

const HTTP_UNAUTHORIZED = 401;

export function handleErrors(response) {
  // Handled: UNAUTHORIZED and OAUTH_ENABLED
  if (env.OAUTH_ENABLED && response.status === HTTP_UNAUTHORIZED) {
    window.location.reload();
  }
  return response;
}