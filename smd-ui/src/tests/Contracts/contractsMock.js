export const contracts = {
  "GreeterA": [
    {
      "createdAt": 1512481078000,
      "address": "0293f9b10a4453667db7fcfe74728c9d821add4b"
    }
  ],
  "Cloner": [
    {
      "createdAt": 1512480630000,
      "address": "d07e932212f7f368b6948ffd96e1d4c726c8395d"
    },
    {
      "createdAt": 1512480770000,
      "address": "2c6619f0418c2f191e2225091f7692363a91c336"
    }
  ],
  "GreeterB": [
    {
      "createdAt": 1512481078000,
      "address": "GreeterA"
    }
  ]
};

export const contractsState = {
  "GreeterA": {
    "instances": [
      {
        "createdAt": 1512481078000,
        "address": "0293f9b10a4453667db7fcfe74728c9d821add4b",
        "fromBloc": true
      }
    ]
  },
  "Cloner": {
    "instances": [
      {
        "createdAt": 1512480630000,
        "address": "d07e932212f7f368b6948ffd96e1d4c726c8395d",
        "fromBloc": true
      },
      {
        "createdAt": 1512480770000,
        "address": "2c6619f0418c2f191e2225091f7692363a91c336",
        "fromBloc": true
      }
    ]
  },
  "GreeterB": {
    "instances": [
      {
        "createdAt": 1512481078000,
        "address": "GreeterA",
        "fromBloc": true
      }
    ]
  }
}

export const filter = "Just to test filter";

export const error = "ERROR";

export const reducerContract = {
  account: [{ balance: 0 }],
  address: "0293f9b10a4453667db7fcfe74728c9d821add4b",
  name: "GreeterA",
  state: {
    "greetA": "function () returns (Address)",
    "greetingA": "Aaaaaaaaa"
  }
}

export const chainIds = [{
  id: '0293f9b10a4453667db7fcfe74728c9d821add4b',
  label: 'new'
}]