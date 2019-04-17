import { env } from "../env";

const HTTP_UNAUTHORIZED = 401;

export function handleErrors(response) {
  if (env.OAUTH_ENABLED && response.status === HTTP_UNAUTHORIZED) {
    window.location.reload();
  }
  return response;
}