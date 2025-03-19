# Update Reserves with New Oracle Addresses

## Prepare
- Install dependencies:
  - Node.js v16+ is required
  - `npm install blockapps-rest dot-env`
- Edit config.sh
  - Edit the oracle addresses
    - to obtain the oracle addresses, check oracle deployment log or oracle_deploy.yaml in the oracle container/volume.
  - Edit the reserve addresses 
    - to obtain the reserve addresses, check cirrus at https://node1.mercata.blockapps.net/cirrus/search/BlockApps-Mercata-Reserve?creator=in.(BlockApps,mercata_usdst)&isActive=eq.true&select=address,name,creator,oracle
  - Edit the admin user username (mercata_usdt for prod, blockapps for testnet2)

## Execute
- Run with `./run.sh`

## (Alternative, for devs) Bash-less execution (node.js only)
- A single js-script run updates one oracle-reserve pair per run.
- Create `.env` from `.env.updateOracleOnReserve` and edit the values in it
- Run:
  ```
  node updateOracleOnReserve.js 2>&1 | tee -a r.log
  ```
