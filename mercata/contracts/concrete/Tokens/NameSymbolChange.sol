/**
 * @title NameSymbolChange
 * @notice Exposes a way to mutate the _name and _symbol
 * @dev This contract is used to change the name and symbol of a token
 */
contract record NameSymbolChange {
    string public _name;
    string public _symbol;

    /**
     * @dev Exposes a way to mutate the _name and _symbol
     */
    function setNameAndSymbol(string name_, string symbol_) external {
        _name = name_;
        _symbol = symbol_;
    }
}
