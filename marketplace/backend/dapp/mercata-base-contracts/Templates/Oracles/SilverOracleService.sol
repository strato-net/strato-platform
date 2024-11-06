pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

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
}