# Identity and Vault

This page covers three things:

- **Login.** Users sign in with OAuth2 / OpenID Connect through the node's nginx.
- **Keys.** Their signing keys are held either custodially in the STRATO Vault or in a wallet they control.
- **On-chain identity.** Usernames map to on-chain `User` contracts through the genesis `UserRegistry`.

## Login through nginx

Every node's nginx (OpenResty with `lua-resty-openidc`) authenticates requests against one OIDC provider.

The provider is set by the node's OAuth credentials:

- **Default:** BlockApps Keycloak, realm `mercata`, discovery URL `https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration`.
- **Local auth:** the node's own provider (see [Local auth](#local-auth)).

There are two ways to authenticate.

**In a browser:**

1. `/login` starts the Authorization Code flow with PKCE.
2. The provider redirects back to `/auth/openidc/return`, and nginx keeps the session in the `strato_session` cookie.
3. Access tokens are renewed automatically when they expire. The requested scope is `openid email profile`.
4. `/auth/logout` ends the session.

If you register your own OIDC client, its redirect URI is `https://<host>/auth/openidc/return`.

**From API clients:** send `Authorization: Bearer <access token>`.

- nginx verifies the JWT against the provider's published keys.
- An invalid or expired token gets HTTP 403.

In both cases, nginx does three things with the token:

- It drops any `X-USER-ACCESS-TOKEN` header sent by the client.
- It forwards the validated token to the services in that header.
- It removes the `Authorization` header before proxying.

Some read-only routes also accept anonymous requests.

### Which claim identifies a user

| Component | Identifier |
|---|---|
| App backend | `preferred_username` claim |
| Vault | Configurable per issuer. The default is `sub`, combined with the token issuer (`iss`). |

A Vault key belongs to the pair (user ID claim, issuer). A user who signs in through a different provider therefore gets a different key.

## Local auth

A node started with `--localAuth` bundles its own identity stack:

- **Ory Kratos:** usernames and passwords.
- **Ory Hydra:** the OAuth2 / OIDC server. nginx serves it under `/auth/`, and its discovery URL is `https://<host>/auth/.well-known/openid-configuration`.
- **A node-local Vault:** runs on the host (port 8093) and is reached through nginx at `/vault/`.

`strato-setup` generates the OAuth client credentials and the local secrets. Users are managed with two commands:

- **The first `strato-up`** creates the first admin (default `admin`). The admin's key is derived from a BIP-39 recovery phrase and doubles as the node's operator identity.
- **`strato-user-add mynode <username>`** adds more users. Each gets a password login and a key derived from its own recovery phrase.

See [Node Operations](../node/operations.md#add-users-local-auth).

## On-chain identity: UserRegistry and User

The genesis block deploys `UserRegistry` at `0x720` (source: `strato/core/strato-genesis/resources/strato/UserRegistry.sol`). It guarantees that each username maps to exactly one `User` contract.

**`UserRegistry` functions:**

| Function | Effect |
|---|---|
| `createUser(username)` | Deploys a `User` contract with CREATE2, using the username as the salt, and hands ownership to the caller |
| `createUserFor(username, owner)` | Same, but the owner is the given address |
| `deriveUserAddress(username)` | Returns a username's `User` address without deploying anything |

Because the salt is the username, anyone can compute a user's contract address. User creation is open to anyone unless the registry's logic contract restricts it.

**The `User` contract** acts as the user's on-chain account (a reverse proxy):

| Function | Effect |
|---|---|
| `addUserAddress`, `revokeUserAddress`, `revokeAllUserAddresses` | Manage the addresses authorized to act for the user. The owner and authorized addresses may call the functions below. |
| `callContract(target, function, args...)` | Calls another contract as the user |
| `createContract`, `createSaltedContract` | Deploy contracts from the user's address |

**Bloc integration.** Bloc's transaction endpoints accept a `username` query parameter. With it, a call or contract creation is routed through that user's `User` contract, whose address is derived from `0x720` and the username.

## The Vault

The STRATO Vault (`strato/vault`) holds users' private keys custodially and signs for them.

| Aspect | How it works |
|---|---|
| Storage | Keys are encrypted at rest with a NaCl SecretBox key derived from the Vault password, and stored per (user, identity provider) in Postgres |
| Shared Vault | Nodes use `https://vault.blockapps.net:8093/strato/v2.3` by default (`--vaultUrl`). A node's metadata (`/strato-api/eth/v1.2/metadata`, field `urls.vault`) shows which Vault it uses. |
| Node key | During setup, `strato-setup` fetches the node's key from the Vault with the node's client credentials, and creates it if missing (`--generateKey`, default `true`) |
| User keys | Created with `POST /strato/v2.3/key`, which nginx forwards to the Vault with the user's token. On a user's first visit, the app backend and apex both look up the user's key and create it if none exists. |
| Signing | `POST /bloc/v2.2/transaction` (and its alias `/strato/v2.3/transaction`) signs server-side with the user's Vault key. `/strato/v2.3/signature` exposes Vault signing to authenticated clients. |
| MPC shards | The Vault can store one shard of a 2-of-2 split key. The wallet holds the other shard, rebuilds the key in memory only to sign, then discards it. The Vault never assembles the key or signs with it. |

### Running your own Vault

`strato/vault/vault-runner` has a minimal self-hosted setup (`run-vault.sh` with `docker-compose.vault.yml`):

- **Transport.** It serves plain HTTP on port 8080 by default. Its README describes switching it to HTTPS on 8443 with your own certificate.
- **Connecting a node.** Start the node with `--vaultUrl=http://<vault-host>:8080/strato/v2.3`, or with the matching `https://` URL.
- **Identity providers.** The Vault's nginx (`vault-nginx`) accepts tokens from configured issuers. The initial issuer is set with `INITIAL_OAUTH_DISCOVERY_URL`, `INITIAL_OAUTH_ISSUER` and `INITIAL_OAUTH_JWT_USER_ID_CLAIM` (default `sub`).
- **Admin tools.** `make change-vault-password` rotates the Vault password. `make migrate-key` moves a single user's key between Vaults. The procedures are in `strato/vault/vault-runner/README.md`.

## Self-custody

Users can also sign in a wallet they control:

- **STRATO Wallet browser extension**
  ([strato-net/strato-wallet](https://github.com/strato-net/strato-wallet)):
    - **Discovery and provider:** EIP-6963 discovery and an EIP-1193 provider (`window.ethereum`), plus `window.strato` for Bloc transactions.
    - **Methods:** `eth_requestAccounts`, `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, `wallet_switchEthereumChain`, `wallet_addEthereumChain`, `strato_sendBlocTransaction` and the standard read methods.
    - **Configuration:** you set its RPC, Bloc, strato-api and Vault URLs and the chain ID in its settings.
- **External wallets in the STRATO app:** under "Connect Wallet", the app offers two routes:
    - **STRATO Wallet:** the OIDC login described above, signing with the Vault-held key.
    - **An external wallet:** MetaMask, Coinbase Wallet or WalletConnect. Bloc can return an unsigned transaction (`/bloc/v2.2/transaction/unsigned`) for the wallet to sign, and a signed transaction is submitted without any server-side signing.

See [Transactions and Fees](transactions-and-fees.md) for the transaction types and signing paths.

!!! note "Removed: X.509 certificates"
    Older STRATO releases tied users and validators to X.509 certificates in an on-chain certificate registry. The current genesis has no certificate registry. Identity is the OIDC login plus the key that signs, and on-chain naming goes through `UserRegistry`.
