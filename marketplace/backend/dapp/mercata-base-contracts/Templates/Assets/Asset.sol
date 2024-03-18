pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

abstract contract Asset is Utils {
    uint public assetMagicNumber = 0x4173736574; // 'Asset'
    address public owner;
    string public ownerCommonName;
    address public originAddress; // For NFTS, this will always be address(this), but this should be the mint address for UTXOs
    string public name;
    string public description;
    string[] public images;
    string[] public files;
    uint public createdDate;
    uint public quantity;
    uint public itemNumber;

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
        uint transferDate
    );

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity
    ) {
        // TODO: Get ownerCommonName by getting commonName field from on-chain wallet at that address
        owner  = msg.sender;
        ownerCommonName = getCommonName(msg.sender);
        name = _name;
        description = _description;
        images = _images;
        files = _files;
        createdDate = _createdDate;
        quantity = _quantity;
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

    modifier fromSale(string action) {
        if (sale == address(0)) {
            string err = "Only the owner can "
                       + action
                       + ".";
            require(getCommonName(msg.sender) == ownerCommonName, err);
        } else {
            string err = "Only the current Sale contract can "
                       + action
                       + ".";
            require(msg.sender == sale, err);
        }
        _;
    }

    // Updated function to add a sale to the whitelist
    function attachSale() public requireOwnerOrigin("attach sale") {
        require(sale == address(0), "Sale is already assigned for this asset");
        sale = msg.sender;
    }

    // Updated function to remove a sale from the whitelist
    function closeSale() public fromSale("close sale") {
        close();
    }

    function close() internal {
        sale = address(0);
    }

    function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber) internal virtual {
        string newOwnerCommonName = getCommonName(_newOwner);

        if(_isUserTransfer && _transferNumber>0){

            emit ItemTransfers(
                originAddress,
                owner,
                ownerCommonName,
                _newOwner,
                newOwnerCommonName,
                name,
                itemNumber,
                itemNumber + _quantity - 1,
                _quantity,
                _transferNumber,
                block.timestamp
                );

            }

        emit OwnershipTransfer(
            originAddress,
            owner,
            ownerCommonName,
            _newOwner,
            newOwnerCommonName,
            itemNumber,
            itemNumber + _quantity - 1
        );
        owner = _newOwner;
        ownerCommonName = newOwnerCommonName;
        close();
    }
    
    function transferOwnership(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber) public fromSale("transfer ownership") {
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");
        // regular transfer - isUserTransfer: false, transferNumber: 0
        // transfer feature - isUserTransfer: true, transferNumber: >0
        _transfer(_newOwner, _quantity, _isUserTransfer, _transferNumber);
    }

    function automaticTransfer(address _newOwner, uint _quantity, uint _transferNumber) public requireOwner("automatic transfer") returns (uint) {
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");
        if (sale == address(0)) {
            // transfer feature - isUserTransfer: true, transferNumber: >0
            _transfer(_newOwner, _quantity, true, _transferNumber);
            return RestStatus.OK;
        } else {
            // transfer feature - isUserTransfer: true, transferNumber: >0
            return Sale(sale).automaticTransfer(_newOwner, _quantity, _transferNumber);
        }
    }

    function updateAsset(
        string[] _images,
        string[] _files
    ) public requireOwner("update asset") returns (uint) {
        images = _images;
        files = _files;
        return RestStatus.OK;
    }
}