pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

interface OracleSubscriber {
    function oraclePriceUpdated(decimal _price, uint _timestamp) public virtual;
}

abstract contract OracleService is Utils {
    decimal public consensusPrice;
    uint public consensusPriceTimestamp;

    address public owner;
    string public ownerCommonName;
    
    string public name;

    bool public isActive;

    address[] public subscribers;
    mapping (address => uint) subscriberMap;

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
        for (uint i = 0; i < subscribers.length; i++) {
            if (subscribers[i] != address(0)) {
                OracleSubscriber(subscribers[i]).oraclePriceUpdated(consensusPrice, consensusPriceTimestamp);
            }
        }
    }

    function _transferOwnership(address _newOwner) internal requireActive("transfer ownership") {
        owner = _newOwner;
        ownerCommonName = getCommonName(_newOwner);
    }

    function getLatestPrice() public view requireActive("get latest price") returns (decimal, uint) {
        return (consensusPrice, consensusPriceTimestamp);
    }

    function subscribe() public {
        if (subscriberMap[msg.sender] == 0) {
            subscribers.push(msg.sender);
            subscriberMap[msg.sender] = subscribers.length;
        }
    }

    function unsubscribe() public {
        uint index = subscriberMap[msg.sender];
        if (index > 0) {
            subscribers[index - 1] = address(0);
            subscriberMap[msg.sender] = 0;
        }
    }
}