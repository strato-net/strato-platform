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
  result: {
    status: "Success",
    hash: "8f6fcd037e028f84ec2e9462c4e29444cd3456c8bc8705723f0c36d075c14c5d"
  },
  chainId: '1c8792a7e43d132487500936d946f510e7ff51635838060757bf886828403a14'
}

export const initialState = {
  modals: {
    methodCallgreet8070db2390462e2b5748085bde1350590e08bb17: {
      isOpen: true,
      result: 'Waiting for method to be called...'
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
            index: 0
          }
        }
      }
    }
  }
}