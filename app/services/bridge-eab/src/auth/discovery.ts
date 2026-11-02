import axios from "axios";

export const readOAuthDiscovery = async (
  discoveryUrl: string,
): Promise<{ issuer: string; token_endpoint: string; jwks_uri?: string }> => {
  const url = new URL(discoveryUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("OAuth discoveryUrl must be HTTPS without credentials, query parameters or fragments");
  }
  const suffix = "/.well-known/openid-configuration";
  if (!url.pathname.endsWith(suffix)) {
    throw new Error("OAuth discoveryUrl must end with /.well-known/openid-configuration");
  }
  const expectedIssuer = url.origin + url.pathname.slice(0, -suffix.length);
  const expectedTokenEndpoint = `${expectedIssuer}/protocol/openid-connect/token`;
  const { data } = await axios.get(discoveryUrl, { maxRedirects: 0, timeout: 30_000 });
  if (data?.issuer !== expectedIssuer || data?.token_endpoint !== expectedTokenEndpoint) {
    throw new Error("OAuth discovery issuer or token endpoint does not match configured expectations");
  }
  return data;
};
