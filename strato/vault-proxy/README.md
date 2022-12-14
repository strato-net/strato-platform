# vault-proxy

Vault-proxy is a super awesome tool. It allows for the removal of the old vault-wrapper from the strato node.

This removal is special as it allows BlockApps (or whomever has access to the shared vault) to remove bad actors at will.

The vault proxy can be enhanced in the future if needed, in particular it can listen for specific api calls and can cache these requests. Or it can be modified to enforce HTTPS connections.

Currently the vault-proxy accepts all requests and adds a new JWT header onto the request then either allows the connection to go onto where it was needing to go something like: `curl --proxy localhost:8013 somewebsite.com` , and it also allows for a more specific proxying. So if the shared vault url looks like `sharedvault.com` and there are api endpoints at the site at `sharedvault.com/strato/v2.3/` then adding the `VAULT_URL=sharedvault.com` flag should be passed in and instead of using the sharedvault.com link everywhere it can now be called using `curl localhost:8013/strato/v2.3/_ping` instead. This makes it very easy and useful to connect to the shared vault anywhere in the codebase.

Furthermore, the vault-proxy makes use of STM for storing the JWT token temporarily, this allows for basically unlimited requests to be performed simultaneously on the shared vault.
