import <509>;

pragma es6;
pragma strict;

abstract contract Asset is PaymentType, SaleState, RestStatus{
    address public owner;
    string public ownerCommonName;
    string public name;
    string public description;
    string[] public images;
    uint public price;
    uint public createdDate;

    // Sale public sale;
    address[] public whitelistedSales;
    SaleFactory salefactory;

    constructor(string _name, string _description, string[] _images, uint _price, uint _createdDate, SaleState _state, PaymentType _payment) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        owner  = c.userAddress();
        ownerCommonName = c.commonName();
        name = _name;
        description =_description;
        images =_images;
        price = _price;
        createdDate = _createdDate;
    }

    modifier requireOwner(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        string err = "Only "
                   + ownerCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = c.commonName();
        require(commonName == ownerCommonName, err);
        _;
    }

    // Updated function to add a sale to the whitelist
    function whitelistSale(address saleContract) public requireOwner("whitelistSale") {
        require(!isSaleWhitelisted(saleContract), "Sale already whitelisted");
        whitelistedSales.push(saleContract);
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
    function dewhitelistSale(address saleContract) public requireOwner("dewhitelistSale") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        for (uint i = 0; i < whitelistedSales.length; i++) {
            if (whitelistedSales[i] == saleContract) {
                delete whitelistedSales[i];
                // Shift elements left to fill the gap left by delete
                for (uint j = i; j < whitelistedSales.length - 1; j++) {
                    whitelistedSales[j] = whitelistedSales[j + 1];
                }
                // whitelistedSales.pop(); // Remove the last element
                break;
            }
        }
    }


    // Updated function to disable all sales
    function disableAllSales() public requireOwner("disableAllSales") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            Sale(whitelistedSales[i]).changeSaleState(SaleState.Closed);
            dewhitelistSale(whitelistedSales[i]);
        }
    }

    function changePrice(uint _price) public requireOwner("Change Asset Price") returns (uint) {
        price = _price;
        return RestStatus.OK;
    }
    
    function transferOwnership(address saleContract, string _newOwnerCommonName, address _newOwner) public requireOwner("Ownership transfer") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        ownerCommonName = _newOwnerCommonName;
        owner = _newOwner;
        disableAllSales();
    }
}