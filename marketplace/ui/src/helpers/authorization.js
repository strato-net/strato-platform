import RestStatus from "http-status-codes";

export const checkAuthorization = (response, body) => {
  if (response.status === RestStatus.UNAUTHORIZED || response.status === RestStatus.FORBIDDEN) {
    window.location.href = body.error.logoutUrl;
  }

  return;
}

