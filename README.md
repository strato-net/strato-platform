# cirrus

With `cirrus`, you can search your `strato` blockchain! It leverages [postgrest](http://postgrest.com) for your smart contracts.

## pre-requirements and installation

`cirrus` is now part of `silo` and hence is automatically deployed. For debugging purposes you can connect your `cirrus` container to an existing `silo` network and use `nodemon` for automatic restart.

## tutorial

1. `POST` the output of `bloc`'s `/state` route to `cirrus/contract/`, alternatively enable the option to `bloc` to post this on compilation. 
2. run `e2e/contract.test.js`

## routes

| Type   |      Route      |  Content-type | Info | Result |
|--------|-----------------|---------------|------|--------|
| `POST` |  `cirrus/contract` | `application/json`| Post schema | |
| `GET`  |  `cirrus/search/` | |  Returns contract types | |
| `GET`  | `cirrus/search/<ContractName>` | | Query a specific contract, see the [API reference](http://postgrest.com/api/reading/) | |

## architecture

![             ┌──────────────────────────────────────────┐
             │                           stateDiffStream│                             ┌─────────────────────────────────────────────────────────┐
             │ :: [{key :: Word160, state :: StateDiff}]│                             │                                          fullStateStream│
             ├──────────────────────────────┬───────────┘                             │:: [ { partition :: SHA, stateDiffs :: stateDiffStream} ]│
             │deadbeef0  , storageDiff_i_0  │                                         ├─────────────────────────────────────────────────────────┴────────────────────────────────┐
             │deadbeef1  , storageDiff_i_1  │                                         │         ┌───────────────┐             ┌───────────────┐                ┌───────────────┐ │
             │deadbeef2  , storageDiff_i_2  │                                         │         │     abba0     │             │     abba1     │                │     abba2     │ │
             │deadbeef1  , storageDiff_i_3  │                                         │┌────────┴───────────────┤  ┌──────────┴───────────────┤     ┌──────────┴───────────────┤ │
╔════╗       │deadbeef1  , storageDiff_i_4  │                          ╔═════════╗    ││deadbeef0  , state_i_0  │  │deadbeef2  , state_i_2    │     │deadbeef3  , state_i_5    │ │
║ VM ║──────▶│deadbeef3  , storageDiff_i_5  │──────┬──────────────────▶║ birrus  ║───▶││deadbeef1  , state_i_1  │  │deadbeef2  , state_i_9    │     │deadbeef5  , state_i_7    │ │─────────┐
╚════╝       │deadbeef4  , storageDiff_i_6  │      │                   ╚═════════╝    ││deadbeef1  , state_i_3  │  │                          │─ ─ ─│deadbeef6  , state_i_8    │ │         │
             │deadbeef5  , storageDiff_i_7  │      │                                  ││deadbeef1  , state_i_4  │  │                          │     │deadbeef3  , state_i_10   │ │         │
             │deadbeef6  , storageDiff_i_8  │      │                                  ││deadbeef4  , state_i+6  │  │                          │     │                          │ │         ▼
             │deadbeef2  , storageDiff_i_9  │      │                                  │└────────────────────────┘  └──────────────────────────┘     └──────────────────────────┘ │    ┌─────────┐
             │deadbeef3  , storageDiff_i_10 │      │                                  └──────────────────────────────────────────────────────────────────────────────────────────┘    │ compact │
             └──────────────────────────────┘      │                                  ┌──────────────────────────────────────────────────────────────────────────────────────────┐    └─────────┘
                 ┌──────────────────────┐          │                                  │         ┌───────────────┐             ┌───────────────┐                ┌───────────────┐ │         │
             ■───┤ one key per address  ├───■      │                                  │         │     abba0     │             │     abba1     │                │     abba2     │ │         │
                 └──────────────────────┘          │                                  │┌────────┴───────────────┤  ┌──────────┴───────────────┤     ┌──────────┴───────────────┤ │         │
                                                   │                                  ││deadbeef0  , state_i_0  │  │deadbeef2  , state_i_9    │     │deadbeef5  , state_i_7    │ │         │
                                                   │                               ┌──││deadbeef1  , state_i_4  │  │                          │     │deadbeef6  , state_i_8    │ │◀────────┘
                                                   │                               │  ││deadbeef4  , state_i_6  │  │                          │─ ─ ─│deadbeef3  , state_i_10   │ │
                                                   │                               │  ││                        │  │                          │     │                          │ │
                                                   │                               │  ││                        │  │                          │     │                          │ │
                                                   │                               │  │└────────────────────────┘  └──────────────────────────┘     └──────────────────────────┘ │
                                                   │                               │  └──────────────────────────────────────────────────────────────────────────────────────────┘
                                                   │                               │                               ┌────────────────────────────────┐
                                                   │                               │  ■────────────────────────────┤ one partition for per codeHash ├────────────────────────────■
                                                   │                               │                               └────────────────────────────────┘
                                                   │                               │
                                                   │                               │
                                                   │                               │
             ┌────────────────────────────────┐    │                               │
             │                  contractStream│    │                               │
             │:: [{key :: SHA, value :: xAbi}]│    │                               │
             ├──────────────────┬─────────────┘    │                               │
             │abba0  , xabi_j_0 │                  │                               │
╔════╗       │abba1  , xabi_j_1 │                  │                               │                                                                                                  ╔═════════╗
║bloc║──────▶│abba2  , xabi_j_2 │──────────────────┴───────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────▶║ cirrus  ║
╚════╝       │abba1  , xabi_j_1 │                                                                                                                                                     ╚═════════╝
             │abba0  , xabi_j_0 │
             └──────────────────┘](cirrus_architecture.png)

## roadmap

+ build our own `postgrest` instead of official docker image to enable:
 + history of accounts, using [temporal_tables](https://github.com/arkhipov/temporal_tables)
 + websockets, using [postgrest-ws](https://github.com/diogob/postgrest-ws)
+ statediffs on transaction level in addition to block level
