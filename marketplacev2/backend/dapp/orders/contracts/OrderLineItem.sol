pragma es6;
pragma strict;
import { Sale } from <f1bf0f62ba0ca6d7c7b7486d33d0a264ba8e38ed>;
 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of OrderLineItem assets
contract OrderLineItem {

    address public owner;
    string public ownerCommonName;

    address public orderLineId;
    string public itemId;
    string public itemSerialNumber;
    uint public createdDate;
    Sale sale;

    constructor(
            address _orderLineId
        ,   string _itemId
        ,   string _itemSerialNumber
        ,   uint _createdDate
        ,   address _sale
    ) public {
        sale = Sale(_sale);
        owner = tx.origin;

        orderLineId = _orderLineId;
        itemId = _itemId;
        itemSerialNumber = _itemSerialNumber == "" ? _itemId : _itemSerialNumber;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerCommonName = ownerCert["commonName"];
        sale.transferOwnership(ownerCommonName);
    }

   
}
