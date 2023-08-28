import <509>;

abstract contract Asset {
    string public originalOwnersOrganization;
    string public originalOwnersCommonName;
    string public currentOwnersOrganization;
    string public currentOwnersCommonName;
    string public assetID;
    string public name;
    string public description;

    Sale public currentBillOfSale;

    constructor(
        string _assetID,
        string _name,
        string _description
    ) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        originalOwnersOrganization = Certificate(account(address(c), "main")).organization();
        originalOwnersCommonName = Certificate(account(address(c), "main")).commonName();
        currentOwnersOrganization = originalOwnersOrganization;
        currentOwnersCommonName = originalOwnersCommonName;
        assetID = _assetID;
        name = _name;
        description = _description;
    }

    function requireOwner(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + currentOwnersCommonName
                   + " from "
                   + currentOwnersOrganization
                   + " can perform "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == currentOwnersOrganization, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == currentOwnersCommonName, err);
    }

    function openSale(string _purchasersOrganization, string _purchasersCommonName, address _assetToBeSold, string _purchasePrice){
        Sale b = new Sale(
                _purchasersOrganization,
                _purchasersCommonName,
                _assetToBeSold,
                _purchasePrice
            );
            currentBillOfSale = b;
    }

    function createBillOfSale(
        string _purchasersOrganization,
        string _purchasersCommonName,
        string _purchasePrice
    ) {
        requireOwner("create a bill of sale");
        require(address(currentBillOfSale) == address(0), "An open bill of sale already exists for this asset");
        Sale b = new Sale(
            _purchasersOrganization,
            _purchasersCommonName,
            address(this),
            _purchasePrice
            );
        currentBillOfSale = b;
    }

    function transferOwnership(
        string _newOwnersOrganization,
        string _newOwnersCommonName
    ) {
        require(msg.sender == address(currentBillOfSale), "Ownership transfer must originate from the active bill of sale");
        currentOwnersOrganization = _newOwnersOrganization;
        currentOwnersCommonName = _newOwnersCommonName;
        currentBillOfSale = Sale(address(0));
    }

    function closeBillOfSale(
    ) {
        require(msg.sender == address(currentBillOfSale), "Bill of sale can only be closed by the active bill of sale");
        currentBillOfSale = Sale(address(0));
    }
}

abstract contract Sale{

    enum Persona {
        NONE,
        Purchaser,
        Seller,
        MAX
    }

    enum SaleState {
        NONE,
        Created,
        Closed,
        MAX
    }

    string sellersOrganization;
    string sellersCommonName;
    string purchasersOrganization;
    string purchasersCommonName;
    Asset assetToBeSold;
    string purchasePrice;
    SaleState state;

    constructor(
        string _purchasersOrganization,
        string _purchasersCommonName,
        address _assetToBeSold,
        string _purchasePrice
    ) {
        assetToBeSold = Asset(_assetToBeSold);
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        sellersOrganization = Certificate(account(address(c), "main")).organization();
        sellersCommonName = Certificate(account(address(c), "main")).commonName();
        string currentOwnerOrg = assetToBeSold.currentOwnersOrganization();
        string currentOwnerName = assetToBeSold.currentOwnersCommonName();
        require(sellersOrganization == currentOwnerOrg, "Only the owner of the asset can open a bill of sale");
        require(sellersCommonName == currentOwnerName, "Only the owner of the asset can open a bill of sale");
        purchasersOrganization = _purchasersOrganization;
        purchasersCommonName = _purchasersCommonName;
        purchasePrice = _purchasePrice;
        state = SaleState.Created;
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
        assetToBeSold.closeBillOfSale();
    }
}

contract NonFungibleAsset is Asset {

    constructor(string _assetID, string _name, string _description) Asset(_assetID, _name, _description) {
    }

    function fractionalize(uint256 _totalCirculation, uint256 _quantity) returns (FungibleAsset) {
        requireOwner("fractionalize the asset");
        require(_totalCirculation > 0, "Total circulation must be greater than zero");
        require(currentBillOfSale == Sale(address(0)), "Cannot fractionalize while a bill of sale is active");

        // Create a new instance of FungibleAsset with the same assetID.
        FungibleAsset newFungibleAsset = new FungibleAsset(assetID, name, description, _quantity, _totalCirculation);

        // Transfer ownership of the asset to the new FungibleAsset contract.
        newFungibleAsset.transferOwnership(currentOwnersOrganization, currentOwnersCommonName);

        // Close the bill of sale, if any.
        if (address(currentBillOfSale) != address(0)) {
            currentBillOfSale.closeBillOfSale();
        }

        // Return the address of the new FungibleAsset contract.
        return newFungibleAsset;
    }

}


contract FungibleAsset is Asset {
    uint public quantity;
    uint public totalCirculation; // Used for securitized assets

    // ERC20 contract representing the NFTs
    ERC20Token public nftToken;

    constructor(string memory _assetID, string _name, string _description, uint _quantity, uint _totalCirculation) Asset(_assetID, _name, _description) {
        quantity = _quantity;
        totalCirculation = _totalCirculation;
    }

    function spend(address[] memory _inputs, uint[] memory _outputQuantities, address[] memory _recipients) public {
        require(_inputs.length == _outputQuantities.length && _inputs.length == _recipients.length, "Invalid input lengths");

        // Ensure that the sender owns the asset being spent.
        requireOwner("spend the asset");

        // Ensure that the total quantity being spent does not exceed the available quantity.
        uint totalOutputQuantity = 0;
        for (uint i = 0; i < _outputQuantities.length; i++) {
            totalOutputQuantity += _outputQuantities[i];
        }
        require(totalOutputQuantity <= quantity, "Insufficient quantity to spend");

        // Transfer the asset units to the recipients.
        for (uint i = 0; i < _inputs.length; i++) {
            require(_inputs[i] != address(0), "Invalid input address");
            require(_recipients[i] != address(0), "Invalid recipient address");

            // Transfer the asset units from the sender to the recipient.
            quantity -= _outputQuantities[i];
            FungibleAsset(_recipients[i]).mintUnitsAsNFTs(new address[](0), new string[](0), msg.sender);
        }
    }

    function unfractionalize(address[] memory _inputs) public returns (NonFungibleAsset) {
        requireOwner("unfractionalize the asset");

        // Ensure that there are inputs to unfractionalize.
        require(_inputs.length > 0, "No inputs provided");

        // Ensure that the sender owns the asset being unfractionalized.
        uint inputQuantity = 0;
        for (uint i = 0; i < _inputs.length; i++) {
            require(_inputs[i] != address(0), "Invalid input address");
            require(FungibleAsset(_inputs[i]).currentOwnersOrganization() == currentOwnersOrganization, "Sender does not own an input asset");
            require(FungibleAsset(_inputs[i]).currentOwnersCommonName() == currentOwnersCommonName, "Sender does not own an input asset");

            // Increment the input quantity.
            inputQuantity += FungibleAsset(_inputs[i]).quantity();

            // Close the bill of sale for the input asset, if any.
            if (address(FungibleAsset(_inputs[i]).currentBillOfSale()) != address(0)) {
                FungibleAsset(_inputs[i]).closeBillOfSale();
            }
        }

        // Mint the unfractionalized asset units to the sender.
        quantity += inputQuantity;
        NonFungibleAsset newNFA = new NonFungibleAsset("", "", ""); // Replace with actual parameters
        newNFA.transferOwnership(currentOwnersOrganization, currentOwnersCommonName);

        return newNFA;
    }

    function mintUnitsAsNFTs(address[] memory _inputs, string[] memory _uniqueIDs, address _recipient) public {
        require(_inputs.length == _uniqueIDs.length, "Invalid input lengths");
        require(_recipient != address(0), "Invalid recipient address");

        // Ensure that the sender owns the asset units being minted.
        for (uint i = 0; i < _inputs.length; i++) {
            require(_inputs[i] != address(0), "Invalid input address");
            require(FungibleAsset(_inputs[i]).currentOwnersOrganization() == currentOwnersOrganization, "Sender does not own an input asset");
            require(FungibleAsset(_inputs[i]).currentOwnersCommonName() == currentOwnersCommonName, "Sender does not own an input asset");

            // Close the bill of sale for the input asset, if any.
            if (address(FungibleAsset(_inputs[i]).currentBillOfSale()) != address(0)) {
                FungibleAsset(_inputs[i]).closeBillOfSale();
            }
        }

        // Mint the specified asset units as NFTs.
        for (uint i = 0; i < _inputs.length; i++) {
            // Transfer ownership of the asset unit to the recipient using the ERC20 token.
            // This assumes that the ERC20 token has a function like `transferFrom` for minting NFTs.
            nftToken.transferFrom(msg.sender, _recipient, 1); // Mint 1 NFT and transfer to the recipient.
        }

        // Reduce the quantity of the fungible asset.
        quantity -= _inputs.length;
    }
}

contract ERC20Token {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        totalSupply = _initialSupply * 10 ** uint256(decimals);
        balanceOf[msg.sender] = totalSupply;
    }

    function transfer(address _to, uint256 _value) public returns (bool success) {
        require(_to != address(0), "Invalid address");
        require(balanceOf[msg.sender] >= _value, "Insufficient balance");

        balanceOf[msg.sender] -= _value;
        balanceOf[_to] += _value;
        emit Transfer(msg.sender, _to, _value);
        return true;
    }

    function approve(address _spender, uint256 _value) public returns (bool success) {
        require(_spender != address(0), "Invalid address");
        allowance[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
        return true;
    }

    function transferFrom(address _from, address _to, uint256 _value) public returns (bool success) {
        require(_from != address(0), "Invalid address");
        require(_to != address(0), "Invalid address");
        require(balanceOf[_from] >= _value, "Insufficient balance");
        require(allowance[_from][msg.sender] >= _value, "Allowance exceeded");

        balanceOf[_from] -= _value;
        balanceOf[_to] += _value;
        allowance[_from][msg.sender] -= _value;
        emit Transfer(_from, _to, _value);
        return true;
    }
}
