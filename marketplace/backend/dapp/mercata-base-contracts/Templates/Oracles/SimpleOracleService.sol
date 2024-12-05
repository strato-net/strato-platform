pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimpleOracleService is OracleService {
    mapping(address => bool) private priceSetters;
    constructor(
	    string _name
    ) public OracleService (_name) {
        priceSetters[msg.sender] = true;
    }

    modifier requireOwner(string action) {
        string err = "Only the owner of the asset can "
                   + action
                   + ".";
        require(msg.sender == owner, err);
        _;
    }

    modifier requirePriceSetter(string action) {
        string err = "Only authorized price setters can "
                   + action
                   + ".";
        require(priceSetters[msg.sender], err);
        _;
    }

    function addPriceSetter(address _priceSetter) public requireOwner("add price setter") {
        require(_priceSetter != address(0), "Invalid address");
        priceSetters[_priceSetter] = true;
    }

    function deactivate() public requireOwner("deactivate") {
        _deactivate();
    }

    function submitPrice(decimal _price, uint _timestamp) public requirePriceSetter("submit price") {
        _submitPrice(_price, _timestamp);
    }

    function transferOwnership(address _newOwner) public requireOwner("transfer owneship") {
        _transferOwnership(_newOwner);
    }
}