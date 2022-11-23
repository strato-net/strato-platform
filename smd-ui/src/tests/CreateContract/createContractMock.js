export const payload = {
  address: "ff1046b63167dbf7fcf2f0deccd2ea6c2972c78e",
  arguments: {
    _greeting: "abrrr"
  },
  contract: "GreeterC",
  fileText: "contract GreeterC {↵    /* Define variable greeting of the type string */↵    string greeting;↵↵    /* This runs when the contract is executed */↵    function GreeterC(string _greeting) public {↵        greeting = _greeting;↵    }↵↵    /* Main function */↵    function greet(string _greeting) constant returns (string) {↵        return greeting;↵    }↵}↵",
  password: "123456",
  searchable: undefined,
  username: "abc",
  greet:'',
  chainId: "75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86"
}

export const contractErrPayload = {
  address: "ff1046b63167dbf7fcf2f0deccd2ea6c2972c78e",
  arguments: {
    _greeting: "abrrr"
  },
  contract: "GreeterCC",
  fileText: "contract GreeterCC {↵    /* Define variable greeting of the type string */↵    string greeting;↵↵    /* This runs when the contract is executed */↵    function GreeterC(string _greeting) public {↵        greeting = _greeting;↵    }↵↵    /* Main function */↵    function greet(string _greeting) constant returns (string) {↵        return greeting;↵    }↵}↵",
  password: "123456",
  searchable: undefined,
  username: "abc",
  greet:'',
  chainId: "75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86"
}

export const createContractResponse = [{
  data: {
    tag: "Upload", contents: {
      address: "1d7c7e29a34a698fa1f7167ec9197be4aad310fc",
      bin: "606060405234610000576040516102a93803806102a9833981016040528080518201919050505b8060009080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061007257805160ff19168380011785556100a0565b828001600101855582156100a0579182015b8281111561009f578251825591602001919060010190610084565b5b5090506100c591905b808211156100c15760008160009055506001016100a9565b5090565b50505b505b6101d0806100d96000396000f30060606040526000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168063ead710c41461003e575b610000565b3461000057610093600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284378201915050505050509190505061011c565b60405180806020018281038252838181518152602001915080519060200190808383600083146100e2575b8051825260208311156100e2576020820191506020810190506020830392506100be565b505050905090810190601f16801561010e5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b602060405190810160405280600081525060008054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156101c35780601f10610198576101008083540402835291602001916101c3565b820191906000526020600020905b8154815290600101906020018083116101a657829003601f168201915b505050505090505b91905056",
      codeHash: "4539dce28866bfd9c9b885aae371fb69cc4d430d580e731fd889bfe3d1a8e916",
      name: "GreeterC",
      xabi: {
        funcs: { greet: { args: { _greeting: { dynamic: true, type: "String", index: 0 } }, vals: { '#0': { dynamic: true, type: "String", index: 0 } } } },
        types: { GreeterC: { type: "Contract", bytes: 0 } },
        constr: { _greeting: { dynamic: true, type: "String", index: 0 } },
        vars: { greeting: { atBytes: 0, dynamic: true, type: "String", public: false } }
      }
    }
  },
  hash: "32aa0f6672c049c167592949182481c248e8c83ccfd40669b94ff40aa15fbdcc",
  status: "Success",
  txResult: {
    blockHash: "5c65518575e160c5d8f4cd5a8f387973600cd838b679db03c0cf2b7d744c646f",
    contractsCreated: "1d7c7e29a34a698fa1f7167ec9197be4aad310fc",
    contractsDeleted: "",
    deletedStorage: "",
    etherUsed: "fffffffffffffffffffffffffffffff954a76563081cf400b6ad15d37f86b700",
    gasUsed: "fffffffffffffffffffffffffffffffffffffee18e0b00bb6ba468f4275d5f97",
    message: "Success!",
    newStorage: "",
    response: "60606040526000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168063ead710c41461003e575b610000565b3461000057610093600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284378201915050505050509190505061011c565b60405180806020018281038252838181518152602001915080519060200190808383600083146100e2575b8051825260208311156100e2576020820191506020810190506020830392506100be565b505050905090810190601f16801561010e5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b602060405190810160405280600081525060008054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156101c35780601f10610198576101008083540402835291602001916101c3565b820191906000526020600020905b8154815290600101906020018083116101a657829003601f168201915b505050505090505b91905056",
    stateDiff: "",
    time: 0.002,
    trace: "",
    transactionHash: "32aa0f6672c049c167592949182481c248e8c83ccfd40669b94ff40aa15fbdcc"
  },

}]

export const payloadCompile = {
  contract: "contract SimpleStorage { uint public storedData; }",
  isOpen: true,
  name: "SimpleStorage",
  solidvm: true,
  type: "COMPILE_CONTRACT_REQUEST"
}

export const payloadCompileSearchable = {
  contract: "contract GreeterC {↵    /* Define variable greeting of the type string */↵    string greeting;↵↵    /* This runs when the contract is executed */↵    function GreeterC(string _greeting) public {↵        greeting = _greeting;↵    }↵↵    /* Main function */↵    function greet(string _greeting) constant returns (string) {↵        return greeting;↵    }↵}↵",
  isOpen: true,
  name: "Greeter",
  searchable: true,
  type: "COMPILE_CONTRACT_REQUEST"
}

export const compileResponse = {
  src: {
    funcs: { greet: { args: { _greeting: { dynamic: true, type: "String", index: 0 } }, vals: { '#0': { dynamic: true, type: "String", index: 0 } } } },
    types: { GreeterC: { type: "Contract", bytes: 0 } },
    constr: { _greeting: { dynamic: true, type: "String", index: 0 } },
    vars: {
      greeting: { atBytes: 0, dynamic: true, type: "String", public: false }
    }
  }
}

export const source = {
  GreeterC: {
    funcs: {
      _greeting: { dynamic: true, type: "String", index: 0 }
    },
    constr: {
      greet: {
        args: {
          _greeting: { dynamic: true, type: "String", index: 0 }
        },
        selector: "ead710c4",
        vals: { '#0': { dynamic: true, type: "String", index: 0 } }
      }
    },
    vars: {
      greeting
        :
        { atBytes: 0, dynamic: true, type: "String" }
    }
  }
}

export const compileError = {"error":"\"src\" (line 1, column 1):\nunexpected 'a'\nexpecting \"pragma\", \"import\", \"contract\", \"library\" or end of input"}

export const responseError = {
  bodyUsed: true,
  ok: false,
  redirected: false,
  status: 400,
  statusText: "Bad Request",
  type: "cors",
  url: "http://localhost/bloc/v2.2/contracts/compile",
  body:{}
}