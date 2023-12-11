import <509>;

pragma es6;
pragma strict;

abstract contract Asset is PaymentType, SaleState, RestStatus{
    address public owner;
    string public ownerCommonName;
    string public name;
    string public description;
    string[] public images;
    uint public createdDate;

    // Sale public sale;
    address[] public whitelistedSales;


    constructor(string _name, string _description, string[] _images, uint _createdDate) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        owner  = c.userAddress();
        ownerCommonName = c.commonName();
        name = _name;
        description =_description;
        images =_images;
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
    
    function transferOwnership(address saleContract, string _newOwnerCommonName, address _newOwner) public requireOwner("Ownership transfer") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        ownerCommonName = _newOwnerCommonName;
        owner = _newOwner;
        disableAllSales();

    }
}