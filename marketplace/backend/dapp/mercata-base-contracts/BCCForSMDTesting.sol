//Copies over all the BCC contracts for manual testing in SMD
pragma es6;
pragma strict;

import <509>;

contract Mercata{}

abstract contract Asset is Utils {
    enum AssetStatus {
        NULL,
        ACTIVE,
        PENDING_REDEMPTION,
        RETIRED,
        MAX
    }

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
        uint price
    );

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
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

    function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber, uint _price) internal virtual {
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
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
        owner = _newOwner;
        ownerCommonName = newOwnerCommonName;
        close();
    }
    
    function transferOwnership(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber, uint _price) public fromSale("transfer ownership") {
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");
        // regular transfer - isUserTransfer: false, transferNumber: 0
        // transfer feature - isUserTransfer: true, transferNumber: >0
        _transfer(_newOwner, _quantity, _isUserTransfer, _transferNumber, _price);
    }

    function automaticTransfer(address _newOwner, uint _price, uint _quantity, uint _transferNumber) public requireOwner("automatic transfer") returns (uint) {
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");
        if (sale == address(0)) {
            // transfer feature - isUserTransfer: true, transferNumber: >0
            _transfer(_newOwner, _quantity, true, _transferNumber, _price);
            return RestStatus.OK;
        } else {
            // transfer feature - isUserTransfer: true, transferNumber: >0
            return Sale(sale).automaticTransfer(_newOwner, _price, _quantity, _transferNumber);
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

    function updateStatus(AssetStatus _status) public returns (uint) {
        status = _status;
        return RestStatus.OK;
    }
}

abstract contract Mintable is UTXO {
    uint public mintableMagicNumber = 0x4d696e7461626c65; // 'Mintable'
    address public minterAddress;
    string public minterCommonName;
    address public mintAddress;
    bool public isMint;
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
    ) UTXO(
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity,
        _status
    ) {
        try {
            assert(Mintable(msg.sender).mintableMagicNumber() == mintableMagicNumber);
            minterAddress = Mintable(msg.sender).minterAddress();
            mintAddress = Mintable(msg.sender).mintAddress();
            isMint = false;
        } catch {
            minterAddress = msg.sender;
            mintAddress = address(this);
            isMint = true;
        }
        minterCommonName = getCommonName(minterAddress);
    }

    function mint(uint _quantity) internal virtual override returns (UTXO) {
        Mintable m = new Mintable(name, description, images, files, createdDate, _quantity, status);
        return UTXO(m);
    }

    function mintNewUnits(uint _quantity) public returns (uint) {
        require(isMint, "Only the mint contract can mint new units");
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(getCommonName(msg.sender) == minterCommonName, "Only the minter can mint new units");
        emit OwnershipTransfer(
            originAddress,
            address(0),
            "",
            owner,
            ownerCommonName,
            itemNumber + quantity,
            itemNumber + quantity + _quantity - 1
        );
        quantity += _quantity;
        return RestStatus.OK;
    }
    
    function _callMint(address _newOwner, uint _quantity) internal virtual override{
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        UTXO newAsset = mint(_quantity);
        // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice: 0
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0, 0);
    }
    
    function checkCondition() internal virtual override returns (bool){
        return true;   
    }
}

abstract contract SemiFungible is Mintable {
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
    ) Mintable (
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity,
        _status
    ) {
    }

    function mint(uint splitQuantity) internal override returns (UTXO) {
        SemiFungible sf = new SemiFungible(name,
                              description, 
                              images, 
                              files, 
                              createdDate, 
                              splitQuantity,
                              status
                              );
        return UTXO(address(sf)); // Typechecker won't let me cast directly to UTXO
    }

    function _callMint(address _newOwner, uint _quantity) internal override{
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        for (uint i = 0; i < _quantity; i++) {
            UTXO newAsset = mint(1);
            // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice:0
            Asset(newAsset).transferOwnership(_newOwner, 1, false, 0, 0);
        }
        
    }

    function checkCondition() internal virtual override returns (bool){
        return true;   
    }
}

abstract contract UTXO is Asset {
    uint public utxoMagicNumber = 0x5554584F; // 'UTXO'

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
    ) Asset(
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity,
        _status
    ) {
    }

    function mint(uint _quantity) internal virtual returns (UTXO) {
        return new UTXO(name, description, images, files, createdDate, _quantity, status);
    }

    // Quantity is already checked by transferOwnership function
    function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber, uint _price) internal override {
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(checkCondition(), "Condition is not met");
        // Create a new UTXO with a portion of the units
        try {
            // This is a hack to prevent the splitted UTXO from infinitely creating new UTXOs
            assert(UTXO(owner).utxoMagicNumber() == utxoMagicNumber);
            owner = _newOwner;
            ownerCommonName = getCommonName(_newOwner);
        } catch {
            
            if(_isUserTransfer && _transferNumber>0){
            // Emit ItemTransfers Event
                emit ItemTransfers(
                    originAddress,
                    owner,
                    ownerCommonName,
                    _newOwner,
                    getCommonName(_newOwner),
                    name,
                    itemNumber,
                    itemNumber + _quantity - 1,
                    _quantity,
                    _transferNumber,
                    block.timestamp,
                    _price
                    );
            }

            emit OwnershipTransfer(
                originAddress,
                owner,
                ownerCommonName,
                _newOwner,
                getCommonName(_newOwner),
                itemNumber,
                itemNumber + _quantity - 1
            );
            _callMint(_newOwner, _quantity);
            quantity -= _quantity;
            itemNumber += _quantity;
        }
    }

    function _callMint(address _newOwner, uint _quantity) internal virtual{
        UTXO newAsset = mint(_quantity);
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0, 0);
    }

    function checkCondition() internal virtual returns (bool){
        return true;
    }

    function requestRedemption(uint _quantity) public returns (uint, address) {
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(getCommonName(msg.sender) == ownerCommonName, "Only the owner of the Asset can request for redemption");

        UTXO newAsset = mint(_quantity);
        Asset(newAsset).transferOwnership(owner, _quantity, false, 0, 0);
        Asset(newAsset).updateStatus(AssetStatus.PENDING_REDEMPTION);
        quantity -= _quantity;

        return (RestStatus.OK, address(newAsset));
    }

    function setQuantity(uint _quantity) external {
        quantity = _quantity;
    } 
}

abstract contract Sale is Utils { 
    Asset public assetToBeSold;
    uint public price;
    uint public quantity;
    address[] public paymentProviders;
    mapping (address => uint) paymentProvidersMap;
    mapping (address => mapping (address => uint)) lockedQuantity;
    uint totalLockedQuantity;
    bool isOpen;

    constructor(
        address _assetToBeSold,
        uint _price,
        uint _quantity,
        address[] _paymentProviders
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        price = _price;
        require(assetToBeSold.quantity() >= _quantity, "Cannot sell more units than what are owned.");
        quantity = _quantity;
        totalLockedQuantity = 0;
        isOpen = true;
        addPaymentProviders(_paymentProviders);
        assetToBeSold.attachSale();
    }

    modifier requireSeller(string action) {
        string sellersCommonName = assetToBeSold.ownerCommonName();
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = getCommonName(msg.sender);
        require(commonName == sellersCommonName, err);
    }

    modifier requirePaymentProvider(string action) {
        require(isPaymentProvider(msg.sender), "Only whitelisted payment providers can perform " + action + ".");
        _;
    }

    modifier requireSellerOrPaymentProvider(string action) {
        string sellersCommonName = assetToBeSold.ownerCommonName();
        string commonName = getCommonName(msg.sender);
        bool isAuthorized = commonName == sellersCommonName
                         || isPaymentProvider(msg.sender);
        require(isAuthorized, "Only the seller, or payment provider can perform " + action + ".");
        _;
    }

    function changePrice(uint _price) public requireSeller("change price"){
        price=_price;
    }

    function addPaymentProviders(address[] _paymentProviders) public requireSeller("add payment providers") {
        for (uint i = 0; i < _paymentProviders.length; i++) {
            address p = _paymentProviders[i];
            paymentProviders.push(p);
            paymentProvidersMap[p] = paymentProviders.length;
        }
    }

    function removePaymentProviders(address[] _paymentProviders) public requireSeller("remove payment providers") {
        for (uint i = 0; i < _paymentProviders.length; i++) {
            address p = _paymentProviders[i];
            uint x = paymentProvidersMap[p];
            if (x > 0) {
                paymentProviders[x-1] = address(0);
                paymentProvidersMap[p] = 0;
            }
        }
    }

    function clearPaymentProviders() public requireSeller("clear payment providers") {
        for (uint i = 0; i < paymentProviders.length; i++) {
            paymentProvidersMap[paymentProviders[i]] = 0;
            paymentProviders[i] = address(0);
        }
        paymentProviders = [];
    }

    function isPaymentProvider(address _paymentProvider) public returns (bool) {
        return paymentProvidersMap[_paymentProvider] != 0;
    }

    function completeSale(
        address purchaser,
        address[] _utxoAddressesPerSale
    ) public requirePaymentProvider("complete sale") returns (uint) {
        uint orderQuantity = takeLockedQuantity(purchaser);

        uint groupedQuantity = combineUTXOs(_utxoAddressesPerSale);
        
        // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice: 0
        try {
            assetToBeSold.transferOwnership(purchaser, orderQuantity, false, 0, 0);
        } catch { // Backwards compatibility for old assets
            address(assetToBeSold).call("transferOwnership", purchaser, orderQuantity, false, 0);
        }        
        assetToBeSold.setQuantity(assetToBeSold.quantity() + groupedQuantity);
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function combineUTXOs(Asset assetToBeSold, address[] _utxoAddressesPerSale) requirePaymentProvider("combine UTXOs") internal returns(uint){
        // Grouping UTXOs
        uint groupedQuantity = 0;
        try {
        for (uint i = 0; i < _utxoAddressesPerSale.length; i++) {
            UTXO utxo = UTXO(_utxoAddressesPerSale[i]);
            if(assetToBeSold.root == utxo.root & assetToBeSold.ownerCommonName == utxo.ownerCommonName){
                groupedQuantity += utxo.quantity();
                utxo.setQuantity(0);
                }
        }
        } catch{}
        return groupedQuantity;
    }

    function automaticTransfer(address _newOwner, uint _price, uint _quantity, uint _transferNumber) public returns (uint) {
        require(msg.sender == address(assetToBeSold), "Only the underlying Asset can call automaticTransfer.");
        uint assetQuantity = assetToBeSold.quantity();
        require(_quantity <= assetQuantity - totalLockedQuantity, "Cannot transfer more units than are available.");
        if (_quantity > quantity) { // We can transfer more than the Sale quantity
            quantity = 0;
        } else {
            quantity -= _quantity;
        }
        // transfer feature - isUserTransfer: true, transferNumber: _transferNumber, transferPrice: _price
        try {
            assetToBeSold.transferOwnership(_newOwner, _quantity, true, _transferNumber, _price);
        } catch { // Backwards compatibility for old assets
            address(assetToBeSold).call("transferOwnership", _newOwner, _quantity, true, _transferNumber);
        }
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function closeSaleIfEmpty() internal {
        if (quantity == 0 && totalLockedQuantity == 0) {
            close();
            isOpen = false;
        }
    }

    function closeSale() public requireSeller("close sale") returns (uint) {
        close();
        isOpen = false;
        return RestStatus.OK;
    }

    function close() internal {
        try {
            assetToBeSold.closeSale();
        } catch {

        }
    }

    function lockQuantity(
        uint quantityToLock,
        address purchaser
    ) requirePaymentProvider("lock quantity") public {
        require(quantityToLock <= quantity, "Not enough quantity to lock");
        require(lockedQuantity[msg.sender][purchaser] == 0, "Order has already locked quantity in this asset.");
        quantity -= quantityToLock;
        lockedQuantity[msg.sender][purchaser] = quantityToLock;
        totalLockedQuantity += quantityToLock;
    }

    function takeLockedQuantity(address orderAddress) internal returns (uint) {
        uint quantityToUnlock = lockedQuantity[msg.sender][orderAddress];
        require(quantityToUnlock > 0, "There are no quantity to unlock for address " + string(orderAddress));
        lockedQuantity[msg.sender][orderAddress] = 0;
        totalLockedQuantity -= quantityToUnlock;
        return quantityToUnlock;
    }

    function getLockedQuantity(address orderAddress) public returns (uint) {
        return lockedQuantity[msg.sender][orderAddress];
    }

    function unlockQuantity(
        address purchaser
    ) requireSellerOrPaymentProvider("unlock quantity") public {
        uint quantityToReturn = takeLockedQuantity(purchaser);
        quantity += quantityToReturn;
    }

    function cancelOrder(
        address purchaser
    ) public requireSellerOrPaymentProvider("cancel order") returns (uint) {
        unlockQuantity(purchaser);
        return RestStatus.OK;
    }

    function update(
        uint _quantity,
        uint _price,
        address[] _paymentProviders,
        uint _scheme
    ) returns (uint) {

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        require(_quantity + totalLockedQuantity <= assetToBeSold.quantity(), "Cannot sell more units than owned");
        quantity = _quantity;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        price = _price;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        clearPaymentProviders();
        addPaymentProviders(_paymentProviders);
      }
      return RestStatus.OK;
    }
}

contract Utils { 
    function getCommonName(address addr) internal returns (string) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(addr);
        string commonName = "";
        try {
            commonName = c.commonName();
        } catch {
            commonName = "Contract " + string(addr);
        }
        return commonName;
    }
}

contract RestStatus {
  uint constant OK = 200;
  uint constant CREATED = 201;
  uint constant ACCEPTED = 202;

  uint constant BAD_REQUEST = 400;
  uint constant UNAUTHORIZED = 401;
  uint constant FORBIDDEN = 403;
  uint constant NOT_FOUND = 404;
  uint constant CONFLICT = 409;

  uint constant INTERNAL_SERVER_ERROR = 500;
  uint constant NOT_IMPLEMENTED = 501;
  uint constant BAD_GATEWAY = 502;
  uint constant GATEWAY_TIMEOUT = 504;
}
