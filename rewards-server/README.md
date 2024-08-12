# Rewards Server

## Conection info
- No ports exposed
- Connects to marketplace node of testnet2 or prod, based on the `NODE` var value (in .env): `prod` for prod, anything else (e.g. `testnet`) for testnet2 

## Deploy dockerized

1. Create `.env` and `secrets.json` in the rewards-server folder.
2. Build and start the server:
    ```
    docker compose up -d --build
    ```
