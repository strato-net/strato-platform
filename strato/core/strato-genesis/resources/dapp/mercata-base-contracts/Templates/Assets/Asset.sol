pragma es6;
pragma strict;

import <509>;
//import "../Enums/RestStatus.sol";
//import "../Utils/Utils.sol";

abstract contract Asset is Utils, ERC20 {
    enum AssetStatus {
        NULL,
        ACTIVE,
        PENDING_REDEMPTION,
        RETIRED,
        MAX
    }

    uint public assetMagicNumber = 0x4173736574; // 'Asset'
    string public ownerCommonName;
    address public originAddress; // For NFTS, this will always be address(this), but this should be the mint address for UTXOs
    string public description;
    string[] public images;
    string[] public files;
    string[] public fileNames;
    uint public createdDate;
    uint public quantity;
    uint public itemNumber;
    AssetStatus public status;

    address public sale;

    event OwnershipTransfer(
        address originAddress,
        address sellerAddress,
        string sellerCommonName,
        address purchaserAddress,
        string purchaserCommonName,
        uint minItemNumber,
        uint maxItemNumber
    );

    event ItemTransfers(
        address indexed assetAddress,
        address indexed oldOwner,
        string oldOwnerCommonName,
        address indexed newOwner,
        string newOwnerCommonName,
        string assetName,
        uint minItemNumber,
        uint maxItemNumber,
        uint quantity,
        uint transferNumber,
        uint transferDate,
        decimal price
    );

    constructor(
        string _name,
        string _symbol,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
    ) ERC20(_name, _symbol) {
        // TODO: Get ownerCommonName by getting commonName field from on-chain wallet at that address
        name = _name;
        description = _description;
        images = _images;
        files = _files; 
        fileNames = _fileNames;
        createdDate = _createdDate;
        quantity = _quantity;
        status = _status;
        try {
            assert(Asset(msg.sender).assetMagicNumber() == assetMagicNumber);
            originAddress = Asset(msg.sender).originAddress();
            itemNumber = Asset(msg.sender).itemNumber();
        } catch {
            originAddress = address(this);
            itemNumber = 1;
            emit OwnershipTransfer(
                originAddress,
                address(0),
                "",
                owner,
                ownerCommonName,
                itemNumber,
                itemNumber + _quantity - 1
            );
        }
    }

    modifier requireOwner(string action) {
        string err = "Only the owner of the asset can "
                   + action
                   + ".";
        require(getCommonName(msg.sender) == ownerCommonName, err);
        _;
    }

    modifier requireOwnerOrigin(string action) {
        string err = "Only the owner of the asset can "
                   + action
                   + ".";
        require(getCommonName(tx.origin) == ownerCommonName, err);
        _;
    }

    function updateAsset(
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) public requireOwner("update asset") returns (uint) {
        images = _images;
        files = _files;
        fileNames = _fileNames;
        return RestStatus.OK;
    }

    function updateStatus(AssetStatus _status) public returns (uint) {
        if (status == AssetStatus.ACTIVE) {
            require(getCommonName(msg.sender) == ownerCommonName, "Only the owner can update the asset's status");
        } else if (status == AssetStatus.PENDING_REDEMPTION) {
            string cn = getCommonName(msg.sender);
            require(cn == ownerCommonName || cn == this.creator, "Only the owner or issuer can update the asset's status");
        } else {
            require(false, "The asset's status can no longer be updated");
        }
        status = _status;
        return RestStatus.OK;
    }
}