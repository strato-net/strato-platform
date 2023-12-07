import "/dapp/orders/contracts/Sales/CarbonSale.sol";

pragma es6;
pragma strict;
import <bbcd8ec0bf0cdf0c17b4123429893df42692052a>;

/// @title A representation of Carbon assets
contract Carbon is UTXO {
    uint serialNumber;
    string public projectType;

    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        uint _serialNumber,
        string _projectType
    ) UTXO (
        _name,
        _description,
        "Carbon",
        "Carbon Offset",
        _images,
        _files,
        _createdDate,
        _quantity
    ) {
        serialNumber = _serialNumber;
        projectType = _projectType;
    }

    function mint(uint splitQuantity) internal override returns (UTXO) {
        Carbon c = new Carbon(name,
                              description, 
                              images, 
                              files, 
                              createdDate, 
                              splitQuantity, 
                              serialNumber + 1, 
                              projectType);
        return UTXO(c);
    }

    function updateCarbon(
        string[] _images, 
        string[] _files, 
        uint _serialNumber,
        string _projectType
    ) public requireOwner("update carbon") returns (uint) {
        serialNumber = _serialNumber;
        projectType = _projectType;
        updateAsset(_images, _files);
        return RestStatus.OK;
    }
}
