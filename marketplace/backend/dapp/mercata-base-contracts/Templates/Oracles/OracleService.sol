pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

abstract contract OracleService is Utils {
    decimal public consensusPrice;

    address public owner;
    string public ownerCommonName;
    
    string public name;

    constructor(
        string _name
    ) {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        name = _name;
    }

    function _submitPrice(decimal _price) internal {
    	consensusPrice = _price;
    }

    function getLatestPrice() external view returns (decimal) {
    	return consensusPrice;
    }
}