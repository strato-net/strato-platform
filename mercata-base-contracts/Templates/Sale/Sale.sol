import <509>;
import "../marketplace/backend/blockapps-sol/lib/rest/contracts/RestStatus.sol";

pragma es6;
pragma strict;

abstract contract Sale is PaymentType, SaleState, RestStatus{ 
    string sellersCommonName;
    string purchasersCommonName;
    Asset assetToBeSold;
    uint price;
    address saleOrderID;
    SaleState state;
    PaymentType payment;


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
        saleOrderID = address(0);
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

    function transferOwnership(string _purchasersCommonName) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        saleOrderID = msg.sender;
        purchasersCommonName = _purchasersCommonName;
        assetToBeSold.transferOwnership(purchasersCommonName);
        state = SaleState.Closed;
        return RestStatus.OK;
    }
}