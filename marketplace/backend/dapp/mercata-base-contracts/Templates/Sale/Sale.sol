import <509>;
import "../marketplace/backend/blockapps-sol/lib/rest/contracts/RestStatus.sol";
pragma es6;
pragma strict;

abstract contract Sale is PaymentType, SaleState, RestStatus{ 
    string public sellersCommonName;
    string public purchasersCommonName;
    Asset public assetToBeSold;
    uint public price;
    uint public saleOrderID;
    SaleState public state;
    PaymentType public payment;


    constructor(
        address _assetToBeSold,
        SaleState _state,
        PaymentType _payment
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        sellersCommonName = assetToBeSold.ownerCommonName();
        purchasersCommonName = sellersCommonName;
        price = assetToBeSold.price();
        state = _state;
        payment = _payment;
        saleOrderID = 0;
    }

    modifier requireSeller(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = c.commonName();
        require(commonName == sellersCommonName, err);
    }

    function changeSaleState(SaleState _state) public requireSeller("Change Payment Type"){
        state=_state;
    }

    function changePaymentType(PaymentType _payment) public requireSeller("Change Payment Type"){
        payment=_payment;
    }

    function transferOwnership(string _purchasersCommonName, address _purchasersAddress, uint _orderId) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        saleOrderID = _orderId;
        purchasersCommonName = _purchasersCommonName;
        assetToBeSold.transferOwnership(address(this), purchasersCommonName, _purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }
}

abstract contract Order is RestStatus, OrderStatus {
    uint public orderId;
    address[] public saleAddresses;
    string public sellerCommonName;
    string public purchasersCommonName;
    address public purchasersAddress;
    uint public createdDate;
    uint public totalPrice;
    OrderStatus public status;
    address public shippingAddress;

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        string _sellerCommonName, 
        string _purchasersCommonName, 
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress
    ) external{
        orderId = _orderId;
        saleAddresses = _saleAddresses;
        sellerCommonName = _sellerCommonName;
        purchasersCommonName = _purchasersCommonName;
        purchasersAddress = _purchasersAddress;
        createdDate = _createdDate;
        totalPrice = _totalPrice;
        status = OrderStatus.AWAITING_FULFILLMENT;
        shippingAddress = _shippingAddress;
    }
    
    function transferOwnership() external returns (uint) {
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale sale = Sale(saleAddresses[i]);
            // Perform the ownership transfer
            sale.transferOwnership(purchasersCommonName, purchasersAddress, orderId);
        }
        status = OrderStatus.CLOSED;
        return RestStatus.OK;
    }
}