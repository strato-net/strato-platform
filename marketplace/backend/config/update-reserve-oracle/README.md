# Update Reserves with New Oracle Addresses

## Prepare
- Install dependencies:
  - Node.js v16+ is required
  - `npm install blockapps-rest`
- Edit config.sh
  - Edit the oracle addresses
    - to obtain the oracle addresses, check oracle deployment log or oracle_deploy.yaml in the oracle container/volume.
  - Edit the reserve addresses 
    - to obtain the reserve addresses, check cirrus at https://node1.mercata.blockapps.net/cirrus/search/BlockApps-Mercata-Reserve?creator=in.(BlockApps,mercata_usdst)&isActive=eq.true&select=address,name,creator,oracle
  - Edit the admin user username (mercata_usdt for prod, blockapps for testnet2)

## Execute
- Run with `./run.sh`

## (Alternative for devs) Node.js-only
One-off execution of the `updateOracleOnReserve.js` script, one oracle-reserve pair per run:
- ```
  USERNAME=username PASSWORD=password ORACLE_ADDRESS=oracle_address RESERVE_ADDRESS=reserve_address node updateOracleOnReserve.js 2>&1 | tee -a "$log_file"
  ```
