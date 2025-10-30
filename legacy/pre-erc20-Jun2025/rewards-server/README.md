# Rewards Server

## Connection info
- No ports exposed
- Connects to marketplace node of testnet2 or prod, based on the `NODE_ENV` var value (in .env): `prod` for prod, anything else (e.g. `testnet`) for testnet2 

## Deploy dockerized

1. Create `.env` and `secrets.json` in the rewards-server folder.
2. Create `latestBlock.json` in the rewards-server/config folder.
   ```
   {
    "latestBlockNumber" : 0
    }   
   ```
   This file will be updated with the latest block it has seen - this prevents duplicate rewards from being sent out.
3. Build and start the server:
    ```
    docker compose up -d --build
    ```
