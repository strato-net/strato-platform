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

    uint public interval; //needed for cata formula

    address public reserve;

    constructor(
        string _name,
        uint _interval //should be same and stored in oracle too
    ) {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        name = _name;
        isActive = true;
        interval = _interval;
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

    function _submitPrice(decimal _price) internal  requireActive("submit price") {
        consensusPriceTimestamp = block.timestamp;
    	consensusPrice = _price;
    }

    function _transferOwnership(address _newOwner) internal requireActive("transfer ownership") {
        owner = _newOwner;
        ownerCommonName = getCommonName(_newOwner);
    }

    function getLatestPrice() public view requireActive("get latest price") returns (decimal, uint) {
        return (consensusPrice, consensusPriceTimestamp);
    }

    function registerReserve(address _reserve) public requireActive("register reserve") {
        reserve = _reserve;
    }
}