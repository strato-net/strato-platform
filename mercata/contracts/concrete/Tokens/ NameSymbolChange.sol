import "../../abstract/ERC20/access/Ownable.sol";

contract record NameSymbolChange is Ownable {
    string public _name;
    string public _symbol;

    /**
     * @dev Exposes a way to mutate the _name and _symbol
     */
    function setNameAndSymbol(string name_, string symbol_) external onlyOwner {
        _name = name_;
        _symbol = symbol_;
    }
}
