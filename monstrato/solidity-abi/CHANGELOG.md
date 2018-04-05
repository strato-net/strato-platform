API changes:
  Have all state variables remember whether they were declared (explicitly or
  implicitly) to be `public`, and have the ABI contain this information.
---
API changes:
  Change Blockchain.Ethereum.Solidity.Layout function `layout` to `makeContractLayout`
  Signature changed from 
  ```SolidityFile -> SolidityFileLayout```
  to 
  ```SolidityContractsDef -> SolidityContractsLayout```

  Change Blockchain.Ethereum.Solidity.Parse function `parse` to `parseSolidity`
  Signature changed from 
  ```SourceName -> String) -> SourceName -> String -> Either ParseError SolidityFile```
  to
  ```FileName -> String -> Either ParseError SolidityFile```

Functionality changes:
  Add support for all import syntax in Solidity.
  Throw JSON-formatted "missing import" error and update README to document.
  Add some Map lookup error messages to catch broken assumptions.
  Correctly compute function selector when the signature contains Enum types.
  Correctly compute size of Enum types.
  Attempt to support qualified contract names for base contracts.
  
Testing changes:
  Create Cabal test suite.  For now just unit tests.

---
Commit 9dc1af4050b3e5a2a5ba05936da5f0af5880b171:
  Start point.  "Classic" solidity-abi, works most of the time, missing
  features.
