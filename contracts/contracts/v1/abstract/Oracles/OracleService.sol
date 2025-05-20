pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

abstract contract OracleService is Utils {
    decimal public consensusPrice;
    uint public consensusPriceTimestamp;

    address public owner;
    string public ownerCommonName;
    
    string public name;

    bool public isActive;

    event PriceUpdated(decimal price, uint timestamp);

    constructor(
        string _name    ) {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        name = _name;
        isActive = true;
    }

    modifier requireActive(string action) {
        string err = "The oracle service must be active to "
                   + action
                   + ".";
        require(isActive, err);
        _;
    }

    function _deactivate() internal requireActive("deactivate") {
        isActive = false;
    }

    function _submitPrice(decimal _price, uint _timestamp) internal  requireActive("submit price") {
        consensusPriceTimestamp = _timestamp;
    	consensusPrice = _price;
        emit PriceUpdated(_price, _timestamp);
    }

    function _transferOwnership(address _newOwner) internal requireActive("transfer ownership") {
        owner = _newOwner;
        ownerCommonName = getCommonName(_newOwner);
    }

    function getLatestPrice() public view requireActive("get latest price") returns (decimal, uint) {
        return (consensusPrice, consensusPriceTimestamp);
    }
}