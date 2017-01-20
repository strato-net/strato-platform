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

## Contract equivalences


### Empty contract

The following three contracts are all the same from `cirrus` point of view.

#### Contract Aa, Ab, Ac

+ codeHash: `d1d29ee74a6d03244189ddb39239adc2a5f77ba91a8df459f17a172dbd96213d`
+ bin-runtime: `60606040526008565b00`
+ bin: `6060604052600a8060106000396000f360606040526008565b00`

```js
contract Aa {
}
```

```js
contract Ab {
	bool a;
}
```

```js
contract Ac {
	string a;
}
```

Even this contract is indistinguishable, since only the constructor is different and that is only encoded in the `bin`:

#### Contract Ad

+ codeHash: `d1d29ee74a6d03244189ddb39239adc2a5f77ba91a8df459f17a172dbd96213d`
+ bin-runtime: `60606040526008565b00`
+ bin: `60606040525b6000600190505b50600a8060196000396000f360606040526008565b00`

```js
contract Ad {
	bool a;
	function Ad() {
		bool b = true;
	}
}
```

Note that we cannot rely on `bin` as a unique identifier - look for example at this contract:

#### Contract Ae

+ codeHash: `d1d29ee74a6d03244189ddb39239adc2a5f77ba91a8df459f17a172dbd96213d`
+ bin-runtime: `60606040526008565b00`
+ bin: `60606040525b6000600190505b50600a8060196000396000f360606040526008565b00`

```js
contract Ae {
	string a;
	function Ae() {
		bool b = true;
	}
}
```

### Unique contracts

To distinguish contracts for search, we need to set the variables that define our contract to use the `public` keyword. Compare the following two contracts:

#### Contract Ba

+ codeHash: `6d9f150c47f7d79202087f453f2495d4ded2f57f7fa0d84b2774d80af8116cb0`
+ bin-runtime: `60606040526000357c0100000000000000000000000000000000000000000000000000000000900480630dbe671f146037576035565b005b60426004805050605a565b60405180821515815260200191505060405180910390f35b600060009054906101000a900460ff168156`
+ bin: `6060604052606d8060106000396000f360606040526000357c0100000000000000000000000000000000000000000000000000000000900480630dbe671f146037576035565b005b60426004805050605a565b60405180821515815260200191505060405180910390f35b600060009054906101000a900460ff168156`


```js
contract Ba {
	bool public a;
}
```

#### Contract Bb

+ codeHash: `776f1f3ed0b276fb75e32a77fed173672ced18bb7b653a9407b39895d884ccba`
+ bin-runtime: `60606040526000357c0100000000000000000000000000000000000000000000000000000000900480630dbe671f1461003957610037565b005b61004660048050506100b4565b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156100a65780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b60006000508054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561014d5780601f106101225761010080835404028352916020019161014d565b820191906000526020600020905b81548152906001019060200180831161013057829003601f168201915b50505050508156`
+ bin: `6060604052610155806100126000396000f360606040526000357c0100000000000000000000000000000000000000000000000000000000900480630dbe671f1461003957610037565b005b61004660048050506100b4565b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156100a65780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b60006000508054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561014d5780601f106101225761010080835404028352916020019161014d565b820191906000526020600020905b81548152906001019060200180831161013057829003601f168201915b50505050508156`

```js
contract Bb {
	string public a;
}
```

### Caveats

If we mix non-unique and unique features, we will only be able to distinguish variables that are shared amongst them, even if the contracts themselves are distinct:

#### Contract Ca, Cb

+ codeHash: `6d9f150c47f7d79202087f453f2495d4ded2f57f7fa0d84b2774d80af8116cb0`
+ bin-runtime: `60606040526000357c0100000000000000000000000000000000000000000000000000000000900480630dbe671f146037576035565b005b60426004805050605a565b60405180821515815260200191505060405180910390f35b600060009054906101000a900460ff168156`
+ bin: `6060604052606d8060106000396000f360606040526000357c0100000000000000000000000000000000000000000000000000000000900480630dbe671f146037576035565b005b60426004805050605a565b60405180821515815260200191505060405180910390f35b600060009054906101000a900460ff168156`

```js
contract Ca {
	bool public a;
	bool b;
}
```

```js
contract Cb {
	bool public a;
	string b;
}
```

The reason that `cirrus` is still able to use the intersaction of the capabilities of these contracts for search, is that `blockapps-js` is able to distinguish `public` variables from non-public ones, and so is preventing variables that are non-public to get into the tables of `cirrus`.

## roadmap

+ build our own `postgrest` instead of official docker image to enable:
 + history of accounts, using [temporal_tables](https://github.com/arkhipov/temporal_tables)
 + websockets, using [postgrest-ws](https://github.com/diogob/postgrest-ws)
+ statediffs on transaction level in addition to block level
