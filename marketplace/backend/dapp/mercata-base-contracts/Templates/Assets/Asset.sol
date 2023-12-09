pragma es6;
pragma strict;

import <509>;
import "../Enums/OrderStatus.sol";
import "../Enums/PaymentType.sol";
import "../Enums/RestStatus.sol";
import "../Enums/SaleState.sol";
import "../Sales/Sale.sol";
import "../Utils/Utils.sol";

abstract contract Asset is PaymentType, SaleState, RestStatus, Utils {
    address public owner;
    string public ownerCommonName;
    string public name;
    string public description;
    string public category;
    string public subCategory;
    string[] public images;
    string[] public files;
    uint public createdDate;
    uint public quantity;

    address public sale;


    constructor(
        string _name,
        string _description,
        string _category,
        string _subCategory,
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
        category = _category;
        subCategory = _subCategory;
        images = _images;
        files = _files;
        createdDate = _createdDate;
        quantity = _quantity;
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
        sale = address(0);
    }

    function _transfer(address _newOwner, uint _quantity) internal virtual {
        owner = _newOwner;
        ownerCommonName = getCommonName(_newOwner);
        closeSale();
    }
    
    function transferOwnership(address _newOwner, uint _quantity) public fromSale("transfer ownership") {
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");
        _transfer(_newOwner, _quantity);
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