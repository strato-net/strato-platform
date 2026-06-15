export const modals = {
  args: {
    _greeting: {
      dynamic: true,
      type: "String",
      index: 0
    }
  },
  error: 'ERROR',
  name: 'Greeter',
  address: '8070db2390462e2b5748085bde1350590e08bb17',
  symbol: 'greet',
  key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17',
  payload: {
    args: {},
    contractAddress: "8070db2390462e2b5748085bde1350590e08bb17",
    contractName: "Greeter",
    methodName: "greet",
    password: "pass",
    userAddress: "76a3192ce9aa0531fe7e0e3489a469018c0bff03",
    username: "tanuj"
  },
  result: [{
    "data": {
        "contents": [
            "200"
        ],
        "tag": "Call"
    },
    "hash": "31bcbc86cb6fdd273443406ae27906485fccc8475b269de04878d9b797c0f47e",
    "status": "Success",
    "txResult": {
        "appName": "",
        "blockHash": "36d2629fb5ef27457eb70a87cd886284d0ac7c197f7b3eaf1102edbb8e3518b1",
        "chainId": null,
        "contractsCreated": "",
        "contractsDeleted": "",
        "deletedStorage": "",
        "etherUsed": "0000000000000000000000000000000000000000000000000000000005f5e100",
        "gasUsed": "0000000000000000000000000000000000000000000000000000000005f5e100",
        "kind": "SolidVM",
        "message": "Success!",
        "newStorage": "",
        "orgName": "Blockapps",
        "response": "(200)",
        "stateDiff": "",
        "status": "success",
        "time": 1.361853e-3,
        "trace": "",
        "transactionHash": "31bcbc86cb6fdd273443406ae27906485fccc8475b269de04878d9b797c0f47e"
    }
}],
  chainId: '1c8792a7e43d132487500936d946f510e7ff51635838060757bf886828403a14',
  isPayable: true
}

export const initialState = {
  modals: {
    methodCallgreet8070db2390462e2b5748085bde1350590e08bb17: {
      result: undefined,
      loading: false,
    }
  }
};

export const methodCallArgs = {
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