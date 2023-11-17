import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/CarbonSale.sol";
import "/dapp/mercata-base-contracts/Templates/Assets/UTXO.sol";

pragma es6;
pragma strict;
import <d85f8ab0f5bb3add2046fd57ba9ba3ef3823d005>;

/// @title A representation of Carbon assets
contract Carbon is ItemStatus, RestStatus, Asset {
    uint public units; // Number of units this asset represents
    uint public serialNo;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
    uint public itemNumber;
    string public projectType;

    event AssetSplit(address newAsset, uint unitsMoved);
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        uint _serialNumber,
        ItemStatus _status,
        uint _itemNumber,
        uint _price,
        address _owner,
        string _projectType,
        SaleState _saleState,
        PaymentType _paymentType,
        bool noSale
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNo = _serialNumber;
        owner = _owner;

        status = _status;
        itemNumber = _itemNumber;
        projectType = _projectType;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
        if(noSale==false)
            createSale(_saleState, _paymentType, _price, _units);
    }

    function splitAsset(uint splitUnits) public requireOwner("Split Asset") returns (address newAssetAddress) {
        require(splitUnits < units, "Cannot split more units than available");
        Carbon newAsset = new Carbon(name, description, images, createdDate, splitUnits, (serialNo+1), status, itemNumber, 0, owner, projectType, SaleState.NONE, PaymentType.NONE, true);
        units -= splitUnits;

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function createSale(SaleState _state, PaymentType _payment, uint _price, uint _units) public requireOwner("Create sale") returns (uint) {
        whitelistedSales.push(address(new CarbonSale(address(this), _state, _payment, _price, _units)));
        return RestStatus.OK;
    }

    function reSell(uint _price, SaleState _saleState, PaymentType[] _paymentTypes) public {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            createSale(_saleState, _paymentTypes[i], _price, units);
        }  
    }
}
