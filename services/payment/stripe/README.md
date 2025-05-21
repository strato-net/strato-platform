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

- `NETWORK` : Network name (prod|testnet|testnet2) to load the corresponding preset of contract addresses

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

To test Stripe webhooks locally during development, run the Stripe CLI:

```bash
stripe listen --forward-to localhost:3002/webhook
```

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
NETWORK=testnet
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
