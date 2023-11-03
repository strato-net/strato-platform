import <509>;

pragma es6;
pragma strict;

abstract contract Sale is PaymentType, SaleState{ 
    string sellersCommonName;
    string purchasersCommonName;
    Asset assetToBeSold;
    uint price;

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
    }

    modifier requireSeller(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string org = c.organization();
        require(org == sellersOrganization, err);
        string commonName = c.commonName();
        require(commonName == sellersCommonName, err);
    }

    function changeSaleState(SaleState _state) public requireSeller("Change Payment Type"){
        state=_state;
    }

    function changePaymentType(PaymentType _payment) public requireSeller("Change Payment Type"){
        payment=_payment;
    }


    function transferOwnership(string _purchasersCommonName) public requireSeller("Transfer Ownership of Asset") {
        purchasersCommonName = _purchasersCommonName;
        assetToBeSold.transferOwnership(purchasersCommonName);
        state = SaleState.Closed;
    }
}

