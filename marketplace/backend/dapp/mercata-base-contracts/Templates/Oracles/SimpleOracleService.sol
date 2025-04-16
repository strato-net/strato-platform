pragma es6;
pragma strict;

import <cbe1614a16d9c75447f40ede6b711e0bb996536b>;

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
        require(getCommonName(msg.sender) == getCommonName(owner), err);
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