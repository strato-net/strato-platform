import { env } from "../env";

const HTTP_UNAUTHORIZED = 401;

export function handleErrors(response) {
  // Handled: UNAUTHORIZED
  if (response.status === HTTP_UNAUTHORIZED) {
    window.location.reload();
  }
  return response;
}