pragma es6;
pragma strict;

import <5761f9a2e0e5e17ceecd772146c95caf7127ea2e>;

contract SilverOracleService is OracleService {
    constructor(
	    string _name
    ) public OracleService (_name) {}

    modifier requireOwner(string action) {
        string err = "Only the owner of the asset can "
                   + action
                   + ".";
        require(msg.sender == owner, err);
        _;
    }

    function deactivate() public requireOwner("deactivate") {
        _deactivate();
    }

    function submitPrice(decimal _price) public requireOwner("submit price") {
        _submitPrice(_price);
    }

    function getLatestPrice() public view returns (decimal, uint) {
        return _getLatestPrice();
    }
}