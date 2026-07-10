# STRATO Wallet (browser extension)

A self-custody, MetaMask-style browser wallet for STRATO. It is **discoverable**
by web3 dApps via EIP-6963 and **interoperable** via standard EIP-1193
(`window.ethereum`), and it also speaks STRATO's native BLOC transaction flow
(`window.strato`).

See the design doc: `../design-documents/strato-wallet-extension.md`.

## Develop

```bash
npm install         # installs deps + runs `wxt prepare`
npm run dev         # launches Chrome with the extension (HMR)
npm run build       # production build -> .output/chrome-mv3
npm run compile     # type-check only
```

Load `.output/chrome-mv3` as an unpacked extension in Chrome
(`chrome://extensions` → Developer mode → Load unpacked) if not using `dev`.

## Try it

Open `test/example-dapp.html` in a browser with the extension loaded. It lists
EIP-6963-announced wallets (you should see "STRATO Wallet"), then lets you run
`eth_requestAccounts`, `eth_chainId`, `eth_getBalance`, `personal_sign`, and a
`strato_sendBlocTransaction`.

Point the wallet at a real node in **Settings** (RPC / BLOC / strato-api / vault
URLs and chain id) — the default targets `http://localhost:8080`.

## Layout

- `entrypoints/background.ts` — wallet core: dApp JSON-RPC router + popup control API
- `entrypoints/content.ts` — relay between page and background
- `entrypoints/inpage.ts` — EIP-1193 provider + EIP-6963 announce + `window.strato`
- `entrypoints/popup/` — React UI (Unlock / Home / Send / Approve / Import / Settings)
- `src/core/` — keyring, vault-crypto, networks, rpc, tx-evm, tx-strato, approvals, permissions, rpc-engine
- `src/messaging/` — page⇄background and popup⇄background protocols
