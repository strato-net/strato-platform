pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";
import "../ERC20/ERC20.sol";

abstract contract Asset is Utils, ERC20 {

    address public owner;
    string public ownerCommonName;
    address public originAddress; // For NFTS, this will always be address(this), but this should be the mint address for UTXOs
    string public name;
    string public description;
    string[] public images;
    string[] public files;
    string[] public fileNames;
    uint public createdDate;
    uint public quantity;
    uint public itemNumber;
    uint public decimals;

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
        uint transferDate,
        decimal price
    );

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        uint _decimals
    ) ERC20(_name, _symbol) {
        // TODO: Get ownerCommonName by getting commonName field from on-chain wallet at that address
        require(_quantity >= 0, "Quantity must be greater than or equal to 0");
        owner  = msg.sender;
        ownerCommonName = getCommonName(msg.sender);
        name = _name;
        description = _description;
        images = _images;
        files = _files; 
        fileNames = _fileNames;
        createdDate = _createdDate;
        decimals = _decimals;
        _mint(msg.sender, _quantity);
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

    function _transferAsset(address _newOwner, uint _quantity, bool _isUserTransfer, decimal _price) internal virtual {
        require(_quantity > 0, "Quantity must be greater than 0");
        string newOwnerCommonName = getCommonName(_newOwner);

        if(_isUserTransfer){

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
                block.timestamp,
                _price
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
        transfer(_newOwner, _quantity);
    }

    function automaticTransfer(address _newOwner, decimal _price, uint _quantity, address _sale) public requireOwner("automatic transfer") returns (uint) {
        require(_quantity > 0, "Quantity must be greater than 0");
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");

        uint currentAmountOwned = balanceOf(msg.sender);
        uint saleQuantity =  0;
        if (_sale != address(0)) {
            saleQuantity = Sale(_sale).getQuantity();
        }

        uint totalQuantity = currentAmountOwned + saleQuantity;

        if (totalQuantity < _quantity) {
            require(false, "Cannot transfer more than available quantity.");
        }
        else{
            if(_quantity < currentAmountOwned){
                _transferAsset(_newOwner, _quantity, true, _price);
                return RestStatus.OK;
            }
            else{
                uint remainingQuantity = _quantity - currentAmountOwned;
                _transferAsset(_newOwner, currentAmountOwned, true, _price);
                return Sale(_sale).automaticTransfer(_newOwner, _price, remainingQuantity);
            }
        }
        return RestStatus.OK;
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

    //work on this 
    function decimals() public view virtual override returns (uint8) {
        return decimals;
    }
    
    function transfer(address to, uint256 value) public virtual override returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, value);
        return true;
    }

    function balanceOf(address accountAddress) public view virtual override returns (uint256) {
        return _balances[accountAddress];
    }

    function approve(address spender, uint256 value) public override returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, value);
        return true;
    }

}