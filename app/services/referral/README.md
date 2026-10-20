# STRATO Referral Service

Submits `Escrow.redeem` for a claimant who cannot pay the gas: the STRATO app's
referral flow, and the Liquidity wallet's airdrops. One route:

    POST /redeem-referral   { recipient, v, r, s }

The request authorizes itself. `r, s, v` is the ephemeral key's signature over
`keccak256(rlp["STRATO_ESCROW_REDEEM_V1", recipient])`; the service recovers the
ephemeral address, checks the Escrow still holds a live deposit under it, and
only then submits. A `X-Wallet-Address` header, when sent, must be the
recipient. There is no login.

The service signs with its own key and pays the gas, so that account must be
funded (USDST or vouchers). Set `SIGNER_PRIVATE_KEY`, or leave it unset and the
service makes a key on first start in `data/signer.key`. Its address is logged
at startup and returned by `GET /health` as `signer`.

Environment: see `.env.example`. Run: `npm start` (ts-node) or `bun src/index.ts`.
