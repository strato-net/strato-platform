import <509>;

contract Mercata{}

abstract contract Asset {
    string public ownerOrganization;
    string public ownerCommonName;
    Sale public sale;

    constructor() {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        ownerOrganization = Certificate(account(address(c), "main")).organization();
        ownerCommonName = Certificate(account(address(c), "main")).commonName();
    }

    modifier requireOwner(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + ownerCommonName
                   + " from "
                   + ownerOrganization
                   + " can perform "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == ownerCommonName, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == ownerCommonName, err);
        _;
    }

    function createBaseSale(string _purchaserOrganization, string _purchaserCommonName, string _purchasePrice) internal returns (Sale) {
        Sale b = new Sale(
            _purchaserOrganization,
            _purchaserCommonName,
            address(this),
            _purchasePrice
        );
        return b;
    }

    function createSale(string _purchaserOrganization, string _purchaserCommonName, string _purchasePrice) public requireOwner("Create sale") {
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale(_purchaserOrganization, _purchaserCommonName, _purchasePrice);
    }

    function transferOwnership(string _newOwnerOrganization, string _newOwnerCommonName) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerOrganization = _newOwnerOrganization;
        ownerCommonName = _newOwnerCommonName;
        sale = Sale(address(0));
    }
}

abstract contract Sale{

    string sellersOrganization;
    string sellersCommonName;
    string purchasersOrganization;
    string purchasersCommonName;
    Asset assetToBeSold;
    string price;

    constructor(
        string _purchasersOrganization,
        string _purchasersCommonName,
        address _assetToBeSold,
        string _price
    ) {
        assetToBeSold = Asset(_assetToBeSold);
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        sellersOrganization = Certificate(account(address(c), "main")).organization();
        sellersCommonName = Certificate(account(address(c), "main")).commonName();
        string currentOwnerOrg = assetToBeSold.ownerOrganization();
        string currentOwnerName = assetToBeSold.ownerCommonName();
        require(sellersOrganization == currentOwnerOrg, "Only the owner of the asset can open a bill of sale");
        require(sellersCommonName == currentOwnerName, "Only the owner of the asset can open a bill of sale");
        purchasersOrganization = _purchasersOrganization;
        purchasersCommonName = _purchasersCommonName;
        price = _price;
    }

    function requireSeller(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + sellersCommonName
                   + " from "
                   + sellersOrganization
                   + " can perform "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == sellersOrganization, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == sellersCommonName, err);
    }
}

abstract contract SimpleSale is Sale{

    enum SaleState {
        NONE,
        Created,
        Closed,
        MAX
    }
    SaleState state;

    constructor(
        string _purchasersOrganization,
        string _purchasersCommonName,
        address _assetToBeSold,
        string _purchasePrice
    ) Sale(_purchasersOrganization, _purchasersCommonName, _assetToBeSold, _purchasePrice){
        state = SaleState.Created;
    }

    function requirePurchaser(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + purchasersCommonName
                   + " from "
                   + purchasersOrganization
                   + " can "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == purchasersOrganization, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == purchasersCommonName, err);
    }

    function requirePurchaserOrSeller(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + purchasersCommonName
                   + " from "
                   + purchasersOrganization
                   + " or "
                   + sellersCommonName
                   + " from "
                   + sellersOrganization
                   + " can "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        string commonName = Certificate(account(address(c), "main")).commonName();
        bool condition = (org == purchasersOrganization && commonName == purchasersCommonName)
                      || (org == sellersOrganization && commonName == sellersCommonName);
        require(condition, err);
    }

    function closeBillOfSale(
    ) {
        requirePurchaserOrSeller("close the bill of sale");
        state = SaleState.Closed;
    }
}

abstract contract Fungible is Asset{
    uint public totalSupply;
    mapping(address => uint) record public balanceOf;
    string public name;

    event Transfer(address indexed from, address indexed to, uint amount);

    constructor(uint _totalSupply, string _name) Asset() {
        totalSupply = _totalSupply;
        name = _name;
        balanceOf[msg.sender] = _totalSupply;
    } 

    function transfer(address recipient, uint amount) external returns (bool) {
        if(balanceOf[msg.sender] - amount <0) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    function mint(uint amount) external {
        balanceOf[msg.sender] += amount;
        totalSupply += amount;
        emit Transfer(address(0), msg.sender, amount);
    }

    function burn(uint amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }
}

abstract contract NonFungible is Asset{
    string private assetID;
    string private name;
    string private symbol;

    // Owner of each token
    mapping(uint256 => address) private owners;

    // Number of tokens owned by each address
    mapping(address => uint256) private balances;


    // Total supply of tokens
    uint256 private totalSupply;

    // Token ID incrementer
    uint256 private tokenIdCounter;

    // Event emitted when a token is transferred
    event Transfer(address indexed from, address indexed to, uint256 tokenId);

    // Event emitted when an approval is set or removed
    event Approval(address indexed owner, address indexed spender, uint256 tokenId, bool approved);

    constructor(string memory _assetID, string memory _name, string memory _symbol, uint256 _totalSupply) Asset(){
        assetID = _assetID;
        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;
    }

    // Function to get the token asset ID
    function getAssetID() public view returns (string memory) {
        return assetID;
    }

    // Function to get the token name
    function getName() public view returns (string memory) {
        return name;
    }

    // Function to get the token symbol
    function getSymbol() public view returns (string memory) {
        return symbol;
    }

    // Function to get the total supply of tokens
    function getTotalSupply() public view returns (uint256) {
        return totalSupply;
    }

    // Function to get the balance of tokens for a given address
    function getBalanceOf(address owner) public view returns (uint256) {
        return balances[owner];
    }

    // Function to get the owner of a specific token
    function getOwnerOf(uint256 tokenId) public view returns (address) {
        return owners[tokenId];
    }

    // Function to transfer a token from one address to another
    function transferFrom(address from, address to, uint256 tokenId) public {
        require(isOwner(msg.sender, tokenId), "Not authorized");
        require(from == getOwnerOf(tokenId), "Not the owner");
        require(to != address(0), "Cannot transfer to zero address");

        transfer(from, to, tokenId);
    }

    // Function to mint a new token and assign it to an address
    function mint(address to) public {
        require(to != address(0), "Cannot mint to zero address");
        uint256 tokenId = tokenIdCounter++;
        owners[tokenId] = to;
        balances[to]++;
        totalSupply++;
        emit Transfer(address(0), to, tokenId);
    }

    // Internal function to perform the actual transfer of a token
    function transfer(address from, address to, uint256 tokenId) internal {
        require(to != address(0), "Cannot transfer to zero address");
        require(to != address(this), "Cannot transfer to the contract itself");
        require(from == getOwnerOf(tokenId), "Not the owner");

        owners[tokenId] = to;
        balances[from]--;
        balances[to]++;
        emit Transfer(from, to, tokenId);
    }

    // Internal function to check if an address is approved or the owner of a token
    function isOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = getOwnerOf(tokenId);
        return (spender == owner);
    }
}

// Create the FractionalizedFungibleAsset contract that inherits from Fungible
abstract contract FractionalizedFungible is Fungible {
    
    // Define the fractionalization ratio (e.g., 1 token can be divided into 100 fractional units)
    uint public fractionalizationRatio;
    
    constructor(string memory _assetID, uint _initialFractionalizationRatio, uint _totalSupply, string _name) Fungible(_assetID, _totalSupply, _name) {
        // Initialize the fractionalization ratio
        fractionalizationRatio = _initialFractionalizationRatio;
    }
    
    // Override the transfer function to handle fractionalization
    function transfer(address recipient, uint amount) external override returns (bool) {
        // Calculate the actual amount of tokens to transfer
        uint tokenAmount = amount / fractionalizationRatio;
        
        // Call the parent transfer function
        return super.transfer(recipient, tokenAmount);
    }
    
    // Override the mint function to handle fractionalization
    function mint(uint amount) external override {
        // Calculate the actual amount of tokens to mint
        uint tokenAmount = amount / fractionalizationRatio;
        
        // Call the parent mint function
        super.mint(tokenAmount);
    }
    
    // Override the burn function to handle fractionalization
    function burn(uint amount) external override {
        // Calculate the actual amount of tokens to burn
        uint tokenAmount = amount / fractionalizationRatio;
        
        // Call the parent burn function
        super.burn(tokenAmount);
    }

}