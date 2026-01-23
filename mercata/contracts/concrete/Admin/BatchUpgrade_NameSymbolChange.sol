/**
 * @title BatchUpgrade_NameSymbolChange
 * @notice Changes the name and symbol of a token atomically through a transient upgrade
 * @dev This contract is used by executeBatchTx in the AdminRegistry contract
 * The entrypoint is batchUpgrade(address targetToken, string newName, string newSymbol)
 */
contract record BatchUpgrade_NameSymbolChange {
  address public changeNameSymbolContract;

  constructor(address changeNameSymbolContract_) {
    changeNameSymbolContract = changeNameSymbolContract_;
  }

  function batchUpgrade(address targetToken, string newName, string newSymbol) external {
    // Save the original logic contract
    address originalLogicContract = targetToken.call("getLogicContract");
    
    // Use the changeNameSymbolContract to change the name and symbol
    targetToken.call("setLogicContract", changeNameSymbolContract);
    targetToken.call("setNameAndSymbol", newName, newSymbol);
    targetToken.call("setLogicContract", originalLogicContract);

    // Test 
    require(targetToken.call("name") == newName, "Name change failed");
    require(targetToken.call("symbol") == newSymbol, "Symbol change failed");
  }
}

