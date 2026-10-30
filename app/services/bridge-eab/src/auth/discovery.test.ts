import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { readOAuthDiscovery } from "./discovery";

const issuer = "https://identity.example/realms/strato";
const discovery = `${issuer}/.well-known/openid-configuration`;
const endpoint = `${issuer}/protocol/openid-connect/token`;

test("OAuth rejects unsafe or unsupported discovery URLs before any network request", async t => {
  const get = t.mock.method(axios, "get", async () => { throw new Error("Unexpected request"); });
  for (const url of ["http://identity.example", "https://user:pass@identity.example", "https://identity.example/#fragment"]) {
    await assert.rejects(readOAuthDiscovery(url), /must be HTTPS/);
  }
  await assert.rejects(readOAuthDiscovery(`${discovery}?redirect=other`), /must be HTTPS/);
  await assert.rejects(readOAuthDiscovery(`${issuer}/discovery`), /must end with/);
  assert.equal(get.mock.callCount(), 0);
});

test("OAuth requires exact issuer and token endpoint matches and forbids redirects", async t => {
  let data: any = { issuer, token_endpoint: endpoint };
  t.mock.method(axios, "get", async (url: string, options: any) => {
    assert.equal(url, discovery);
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.timeout, 30_000);
    return { data };
  });
  assert.equal((await readOAuthDiscovery(discovery)).token_endpoint, endpoint);
  for (const replacement of [{ issuer: `${issuer}-other`, token_endpoint: endpoint },
    { issuer, token_endpoint: "http://identity.example/token" },
    { issuer, token_endpoint: "https://attacker.example/token" },
    { issuer, token_endpoint: `${endpoint}-other` }, {}]) {
    data = replacement;
    await assert.rejects(readOAuthDiscovery(discovery), /does not match/);
  }
});

test("OAuth client disables credential redirects after validating discovery", async t => {
  const simpleOauth2 = (await import("simple-oauth2")).default;
  const OAuthUtil = (await import("./oauth")).default;
  t.mock.method(axios, "get", async () => ({ data: { issuer, token_endpoint: endpoint } }));
  let constructed = 0;
  t.mock.method(simpleOauth2 as any, "ResourceOwnerPassword", function (credentials: any) {
    constructed++;
    assert.equal(credentials.http.redirects, 0);
    assert.equal(credentials.auth.tokenHost + credentials.auth.tokenPath, endpoint);
    return {};
  });
  const config = { clientId: "client", clientSecret: "secret", openIdDiscoveryUrl: discovery };
  await OAuthUtil.init(config);
  await assert.rejects(OAuthUtil.init({ ...config, openIdDiscoveryUrl: `${issuer}-other/.well-known/openid-configuration` }), /does not match/);
  assert.equal(constructed, 1, "invalid discovery must not initialize a credential-bearing client");
});
