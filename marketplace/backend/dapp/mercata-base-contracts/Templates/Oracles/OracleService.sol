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

    constructor(
        string _name
    ) {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        name = _name;
        isActive = true;
    }

    function _deactivate() internal {
        isActive = false;
    }

    function _submitPrice(decimal _price) internal {
        consensusPriceTimestamp = block.timestamp;
    	consensusPrice = _price;
    }

    function _getLatestPrice() internal view returns (decimal, uint) {
        return (consensusPrice, consensusPriceTimestamp);
    }
}