# Stripe Payment Service

This service integrates Stripe payment processing into the Mercata Testnet2 environment. It supports secure API interactions for payment creation, confirmation, and webhook handling.

## Environment Variables

The following environment variables are required to run the Stripe payment service:

- `CLIENT_SECRET`: Secret key used for authentication  

- `CLIENT_ID`: The client identifier used for OAuth flows  

- `OAUTH_DISCOVERY_URL`: The OAuth 2.0/OpenID Connect discovery document URL  

- `NODE_URL`: The URL of the Mercata testnet node  

- `STRIPE_SECRET_KEY`: Secret key for authenticating Stripe API calls  

- `STRIPE_WEBHOOK_SECRET`: Secret used to verify incoming webhooks from Stripe  

- `ONRAMP`: On Ramp contract address to use as part of the server

## Running the App

Ensure all required environment variables are set before running the service.

### Development

- Have .env with env values
- Run:
```bash
npm install
npm run dev
```
- The app will start on port 3002 with http

### 🔬 Local end-to-end test guide  (“card → USDT → voucher”) 

This assumes you are **not** relying on Stripe's remote webhooks – the local
Stripe service polls and mints vouchers automatically.

1. Environment file

   ```bash
   # .env (or env.list for Docker)
   OAUTH_DISCOVERY_URL=<KC-realm-discovery-url>
   CLIENT_ID=localhost                       # or your client-id
   CLIENT_SECRET=<client-secret>
   NODE_URL=http://localhost:8545/strato/v2.3
   STRIPE_SECRET_KEY=sk_test_…
   ONRAMP=<will fill in after deploy>
   VOUCHER_CONTRACT_ADDRESS=<voucher-contract>
   ```

2. Deploy contracts

   1. Deploy **Voucher**.
   2. Deploy **OnRamp** (use *Base Code Collection* so Cirrus can index it).
   3. Save the OnRamp address into `ONRAMP` in the `.env` **and restart** the
      service so it picks up the change.

3. Prepare the **service signer** (the address behind your JWT)

   ```bash
   # a) fund with gas (USDST or Vouchers)
   # b) allow minting on Voucher
   Voucher.addMinter(<service-signer>)
   ```

4. Register the payment provider (must be done from an OnRamp admin)

   ```bash
   OnRamp.addPaymentProvider(
     ProviderAddress: <service-signer>,
     Name: "Local Stripe Service",
     Endpoint: "http://localhost:3002/checkout"
   )
   ```

5. Create the listing for **USDST**

   1. Call `registerToken(USDST)` on your OnRamp's corresponding Token Factory.
   2. Call `setApprovedSeller(<your-EOA>, true)` on your OnRamp contract.
   3. Call `approve(<OnRamp.address>, 999999999999999999999999)` on the USDST contract.
   4. Call `createListing(<USDST.address>, <amount>, <marginBps>, ["<service-signer>"])` on your OnRamp contract.

6. Set the price oracle in OnRamp

7. Install & run the service

   ```bash
   npm install
   npm run dev        # service on http://localhost:3002
   ```

8. Front-end test

    • Complete the Stripe Checkout form with a test card from the UI.

9. Add some console.logs throughout the functions used to observe behavior in your terminal


### Production

Build the project and start the compiled service for production:

#### Dockerized:
- Create env.list:
```
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
CLIENT_ID=client-id-here
CLIENT_SECRET=client-secret-here
NODE_URL=https://node5.mercata-testnet.blockapps.net/
STRIPE_SECRET_KEY=sk_test_key_here
STRIPE_WEBHOOK_SECRET=whsec_key_here
ONRAMP=0x1009
```
- Run:
```bash
sudo docker build --tag stripe-image .
sudo docker run -d --name=stripe -p 3002:3002 --env-file=env.list stripe-image
```
- The app will start on port 3002 with http

#### NPM-only:
- Have .env with env values
- Run:
```bash
npm install
npm run build
```
- serve the dist/app.js (e.g. with `serve` or `pm2`, or other way, e.g. aws lambda)

### Webhook

Ensure your webhook handler is exposed to Stripe for live event reception and secure processing.

## Notes

- All credentials shown here are examples and should be kept secure.
- For production use, rotate secrets regularly and store them securely using a secret manager.
