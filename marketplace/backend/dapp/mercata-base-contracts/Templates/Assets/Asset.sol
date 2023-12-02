pragma es6;
pragma strict;

import <509>;
import "../Enums/ItemStatus.sol";
import "../Enums/OrderStatus.sol";
import "../Enums/PaymentType.sol";
import "../Enums/RestStatus.sol";
import "../Enums/SaleState.sol";
import "../Sales/Sale.sol";
import "../Utils/Utils.sol";

abstract contract Asset is PaymentType, SaleState, RestStatus, ItemStatus, Utils {
    address public owner;
    string public ownerCommonName;
    string public name;
    string public description;
    string[] public images;
    uint public createdDate;
    ItemStatus public status;

    // Sale public sale;
    address[] public whitelistedSales;


    constructor(string _name, string _description, string[] _images, uint _createdDate) {
        // TODO: Get ownerCommonName by getting commonName field from on-chain wallet at that address
        owner  = msg.sender;
        ownerCommonName = getCommonName(msg.sender);
        name = _name;
        description =_description;
        images =_images;
        createdDate = _createdDate;
        status = ItemStatus.UNPUBLISHED;
    }

    modifier requireOwner(string action) {
        require(msg.sender == owner, err);
        _;
    }

    modifier requireWhitelisted(string action) {
        bool isWhitelisted = isSaleWhitelisted(msg.sender);
        string err = "Only a whitelisted Sale contract can "
                   + action
                   + ".";
        require(isWhitelisted, err);
        _;
    }

    // Updated function to add a sale to the whitelist
    function whitelistSale(address saleContract) public requireOwner("whitelistSale") {
        require(!isSaleWhitelisted(saleContract), "Sale already whitelisted");
        whitelistedSales.push(saleContract);
    }

    function changePrice(uint _price) public requireOwner("change price") returns (uint) {
        if (whitelistedSales.length > 0) {
            for (uint i = 0; i < whitelistedSales.length; i++) {
                Sale(whitelistedSales[i]).changePrice(_price);
            }
        }
        return RestStatus.OK;
    }

    // Helper function to check if a sale is already whitelisted
    function isSaleWhitelisted(address saleContract) public returns (bool) {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            if (whitelistedSales[i] == saleContract) {
                return true;
            }
        }
        return false;
    }

    // Updated function to remove a sale from the whitelist
    function dewhitelistSale(address saleContract) public requireOwner("dewhitelist a Sale") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        address[] newArray = [];
        for (uint i = 0; i < whitelistedSales.length; i++) {
            if (whitelistedSales[i] != saleContract) {
                newArray.push(whitelistedSales[i]);
            }
        }
        whitelistedSales = newArray;
    }


    // Updated function to disable all sales
    function disableAllSales() public requireOwner("disableAllSales") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            Sale(whitelistedSales[i]).changeSaleState(SaleState.Closed);
            whitelistedSales=[];
        }
    }

    // Hook for inherited contracts to perform before ownership is transferred
    function preTransfer() internal virtual { }

    // Hook for inherited contracts to perform after ownership is transferred
    function postTransfer() internal virtual { }
    
    function transferOwnership(address _newOwner) public requireWhitelisted("Ownership transfer") {
        preTransfer();
        owner = _newOwner;
        ownerCommonName = getCommonName(_newOwner);
        disableAllSales();
        status = ItemStatus.UNPUBLISHED;
        postTransfer();
    }

    function updateAsset(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        uint _price
    ) public requireOwner("update asset") returns (uint) {
        name = _name;
        description = _description;
        images = _images;
        if (_status == ItemStatus.UNPUBLISHED) {
            disableAllSales();
            status = _status;
            return RestStatus.OK;
        }
        uint price = Sale(whitelistedSales[0]).price();
        if (_price != price) {
            changePrice(_price);
        }
        return RestStatus.OK;
    }
}