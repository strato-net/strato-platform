export const contract = {
  account: [{ "contractRoot": "1578e5fa942f475f407b9f9c67c4474bd4856a5f1935ee3fb7ffe4333018f1d7", "nonce": 0 }],
  address: '0293f9b10a4453667db7fcfe74728c9d821add4b',
  error: 'ERROR',
  name: 'Greeter',
  state: { dna: '', geneticallyModify: 'function() {}', name: '' },
  instances: [
    {
      address: "b7b986bf23faebd8d745c65fa42a8c2f0fc2ebb9",
      greeting: ""
    }],
  chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
}

export const accounts = [
  {
    "contractRoot": "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    "next": "/eth/v1.2/account?address=3771b31420eda628bf03cd5b119249da0fb4aa6d&index=5",
    "kind": "AddressStateRef",
    "balance": "0",
    "address": "3771b31420eda628bf03cd5b119249da0fb4aa6d",
    "latestBlockNum": 3,
    "codeHash": "21a8ff8729ddb7e677cb21b5950d30c2a4f0fd4586ad8ddd801e130c1492f771",
    "code": "60606040526000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff1680632a1afcd914603c575b6000565b346000576046605c565b6040518082815260200191505060405180910390f35b6000548156",
    "nonce": 0
  }
]

export const cirrus = [{
  "address": "1f457d150e6fababa0164ac12cec00c2bc61de90",
  "dna": "trewt",
  "name": ""
}]

export const state = {
  "dna": "",
  "geneticallyModify": "function (String) returns ()",
  "name": ""
}

export const modals = {
  name: 'Foo',
  key: 'data-card-1234567-',
  address: '1234567',
  chainId: '123456756789876789876543345678',
  error: {
    message: 'some error'
  }
}

export const contractInfoResponse = {
  address: '1234567',
  chainId: '123456756789876789876543345678',
  xabi: {
    funcs: {
      geneticallyModify: {
        args: {
          _dna: {
            dynamic: true,
            type: "String",
            tag: "String",
            index: 0
          }
        }
      }
    }
  }
}

export const initialState = {
  contractInfos: {}
}