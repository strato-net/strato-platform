pragma es6;
pragma strict;

contract Mercata{}

abstract contract Asset is Utils {
    uint public assetMagicNumber = 0x4173736574; // 'Asset'
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
        string[] _fileNames,
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
        fileNames = _fileNames;
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
        string[] _fileNames
    ) public requireOwner("update asset") returns (uint) {
        images = _images;
        files = _files;
        fileNames = _fileNames;
        return RestStatus.OK;
    }
}

abstract contract UTXO is Asset {
    uint public utxoMagicNumber = 0x5554584F; // 'UTXO'

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity
    ) Asset(
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity
    ) {
    }

    function mint(uint _quantity) internal virtual returns (UTXO) {
        return new UTXO(name, description, images, files, fileNames, createdDate, _quantity);
    }

    // Quantity is already checked by transferOwnership function
    function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber) internal override {
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
                    block.timestamp
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
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0);
    }

    function checkCondition() internal virtual returns (bool){
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
        string[] _fileNames,
        uint _createdDate,
        uint _quantity
    ) Mintable (
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity
    ) {
    }

    function mint(uint splitQuantity) internal override returns (UTXO) {
        SemiFungible sf = new SemiFungible(name,
                              description, 
                              images, 
                              files, 
                              fileNames,
                              createdDate, 
                              splitQuantity);
        return UTXO(address(sf)); // Typechecker won't let me cast directly to UTXO
    }

    function _callMint(address _newOwner, uint _quantity) internal override{
        for (uint i = 0; i < _quantity; i++) {
            UTXO newAsset = mint(1);
            // regular transfer - isUserTransfer: false, transferNumber: 0
            Asset(newAsset).transferOwnership(_newOwner, 1, false, 0);
        }
        
    }

    function checkCondition() internal virtual override returns (bool){
        return true;   
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
        string[] _fileNames,
        uint _createdDate,
        uint _quantity
    ) UTXO(
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity
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
        Mintable m = new Mintable(name, description, images, files, fileNames, createdDate, _quantity);
        return UTXO(m);
    }

    function mintNewUnits(uint _quantity) public returns (uint) {
        require(isMint, "Only the mint contract can mint new units");
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
        UTXO newAsset = mint(_quantity);
        // regular transfer - isUserTransfer: false, transferNumber: 0
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0);
    }
    
    function checkCondition() internal virtual override returns (bool){
        return true;   
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

abstract contract Order is Utils {
    enum OrderStatus {
        NULL,
        AWAITING_FULFILLMENT,
        AWAITING_SHIPMENT,
        CLOSED,
        CANCELED,
        PAYMENT_PENDING,
        MAX
    }

    uint public orderId;
    address[] public saleAddresses;
    uint[] public quantities;
    bool[] public completedSales;
    uint outstandingSales;
    address public purchasersAddress;
    string public purchasersCommonName;
    string public sellersCommonName;
    uint public createdDate;
    uint public totalPrice;
    OrderStatus public status;
    uint public shippingAddressId;
    string public paymentSessionId;
    uint public fulfillmentDate;
    string public comments;

    event OrderCompleted(uint fulfillmentDate, string comments);

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        uint[] _quantities,
        uint _createdDate,
        uint _shippingAddressId,
        string _paymentSessionId,
        OrderStatus _status
    ) external{
        require(_saleAddresses.length == _quantities.length, "Number of sales doesn't match number of quantities.");
        orderId = _orderId;
        purchasersAddress = msg.sender;
        purchasersCommonName = getCommonName(msg.sender);
        createdDate = _createdDate;
        totalPrice = 0;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            address a = _saleAddresses[i];
            Sale s = Sale(a);
            string _sellersCommonName = s.assetToBeSold().ownerCommonName();
            if (sellersCommonName == "") {
                sellersCommonName = _sellersCommonName;
            } else {
                require(sellersCommonName == _sellersCommonName, "Cannot create order from multiple sellers.");
            }
            uint q = _quantities[i];
            s.lockQuantity(q);
            totalPrice += s.price() * q;
            saleAddresses.push(a);
            completedSales.push(false);
            quantities.push(q);
            outstandingSales++;
        }
        status = _status;
        shippingAddressId = _shippingAddressId;
        paymentSessionId = _paymentSessionId;

        // Credit Card Payment Orders go in this block
        if(status == OrderStatus.AWAITING_FULFILLMENT)
        {
            completeOrder(_createdDate,"Thank you for your payment.");
        }
    }

    function completeOrder(uint _fulfillmentDate, string _comments) public returns (uint) {
        require(status == OrderStatus.AWAITING_FULFILLMENT, "Order is not in AWAITING FULFILLMENT state.");
        for (uint i = 0; i < saleAddresses.length; i++) {
            if (!completedSales[i]) {
                Sale(saleAddresses[i]).completeSale();
                completedSales[i] = true;
                outstandingSales--;
            }
        }
        if (outstandingSales == 0) {
            fulfillmentDate = _fulfillmentDate;
            comments = _comments;
            emit OrderCompleted(_fulfillmentDate, _comments);
            status = OrderStatus.CLOSED;
        }
        return RestStatus.OK;
    }

    function updateComment(string _comments) external returns (uint) {
        require(status != OrderStatus.CLOSED && status != OrderStatus.CANCELED, "Order already closed.");
        comments = _comments;

        return RestStatus.OK;
    }

    function unlockSales() internal {
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale s = Sale(saleAddresses[i]);
            try {
                s.unlockQuantity();
            } catch {

            }
        }
    }

    function updateOrderStatus(OrderStatus _status) external returns (uint) {
        require((tx.origin == purchasersAddress || getCommonName(tx.origin) == sellersCommonName), "Only the purchaser/seller can update the order status");
        if(status == OrderStatus.AWAITING_FULFILLMENT){
            if (_status == OrderStatus.AWAITING_SHIPMENT) {
                status = _status;
            } 
        }else if(status == OrderStatus.AWAITING_SHIPMENT){
            if (_status == OrderStatus.CLOSED) {
                status = _status;
            } 
        }else if(status == OrderStatus.PAYMENT_PENDING){
            if (_status == OrderStatus.AWAITING_FULFILLMENT) {
                status = _status;
            } 
        }
        return RestStatus.OK;
    }

    function onCancel(string _comments) internal virtual {}

    function cancelOrder(string _comments) external returns (uint) {
        require(status != OrderStatus.CLOSED && status != OrderStatus.CANCELED, "Order already closed.");
        require((tx.origin == purchasersAddress || getCommonName(tx.origin) == sellersCommonName), "Only the purchaser/seller can cancel the order");
        onCancel(_comments);
        unlockSales();
        status = OrderStatus.CANCELED;
        return RestStatus.OK;
    }
}

abstract contract BasePaymentProvider is Utils {
    address public owner;
    string public ownerCommonName;


    string public name;
    string public accountId;
    bool public chargesEnabled;
    bool public detailsSubmitted;
    bool public payoutsEnabled;
    uint public eventTime;
    uint public createdDate;
    bool public accountDeauthorized;

    event Payment(
        string sellerAccountId,
        string amount
    );


    constructor (
            string _name
        ,   string _accountId
        ,   uint _createdDate
    ) public {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        name = _name;
        accountId = _accountId;
        chargesEnabled = false;
        detailsSubmitted = false;
        payoutsEnabled = false;
        eventTime = 0;
        createdDate = _createdDate;
        accountDeauthorized = false;
    }

    function update(
        bool _chargesEnabled
    ,   bool _detailsSubmitted
    ,   bool _payoutsEnabled
    ,   uint _eventTime
    ,   bool _accountDeauthorized
    ,   uint _scheme
    ) returns (uint) {

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        chargesEnabled = _chargesEnabled;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        detailsSubmitted = _detailsSubmitted;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        payoutsEnabled = _payoutsEnabled;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        eventTime = _eventTime;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        accountDeauthorized = _accountDeauthorized;
      }

      return RestStatus.OK;
    }
}

abstract contract Sale is Utils { 
    Asset public assetToBeSold;
    uint public price;
    uint public quantity;
    address[] public paymentProviders;
    mapping (address => uint) paymentProvidersMap;
    mapping (address => uint) lockedQuantity;
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
        string commonName = getCommonName(tx.origin);
        require(commonName == sellersCommonName, err);
    }

    modifier requireSellerOrBuyer(string action) {
        string sellersCommonName = assetToBeSold.ownerCommonName();
        Order order = Order(msg.sender);
        string purchasersCommonName = order.purchasersCommonName();
        string err = "Only "
                   + sellersCommonName
                   + ","
                   + purchasersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = getCommonName(tx.origin);

        require((commonName == purchasersCommonName || commonName == sellersCommonName), err);

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
    ) public requireSellerOrBuyer("complete sale") returns (uint) {
        Order order = Order(msg.sender);
        address purchaser = order.purchasersAddress();
        uint orderQuantity = takeLockedQuantity(msg.sender);
        // regular transfer - isUserTransfer: false, transferNumber: 0
        assetToBeSold.transferOwnership(purchaser, orderQuantity, false, 0);
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function automaticTransfer(address _newOwner, uint _quantity, uint _transferNumber) public returns (uint) {
        require(msg.sender == address(assetToBeSold), "Only the underlying Asset can call automaticTransfer.");
        uint assetQuantity = assetToBeSold.quantity();
        require(_quantity <= assetQuantity - totalLockedQuantity, "Cannot transfer more units than are available.");
        if (_quantity > quantity) { // We can transfer more than the Sale quantity
            quantity = 0;
        } else {
            quantity -= _quantity;
        }
        // transfer feature - isUserTransfer: true, transferNumber: _transferNumber
        assetToBeSold.transferOwnership(_newOwner, _quantity, true, _transferNumber);
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

    function lockQuantity(uint quantityToLock) public {
        require(quantityToLock <= quantity, "Not enough quantity to lock");
        require(lockedQuantity[msg.sender] == 0, "Order has already locked quantity in this asset.");
        quantity -= quantityToLock;
        lockedQuantity[msg.sender] = quantityToLock;
        totalLockedQuantity += quantityToLock;
    }

    function takeLockedQuantity(address orderAddress) internal returns (uint) {
        uint quantityToUnlock = lockedQuantity[orderAddress];
        require(quantityToUnlock > 0, "There are no quantity to unlock for address " + string(orderAddress));
        lockedQuantity[orderAddress] = 0;
        totalLockedQuantity -= quantityToUnlock;
        return quantityToUnlock;
    }

    function unlockQuantity() public {
        uint quantityToReturn = takeLockedQuantity(msg.sender);
        quantity += quantityToReturn;
    }

    function cancelOrder() public requireSeller("cancel order") returns (uint) {
        unlockQuantity();
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
        string commonName = getUserCert(addr)["commonName"];
        if (commonName == ""){
            commonName = "Contract " + string(addr);
        }
        return commonName;
    }
}
