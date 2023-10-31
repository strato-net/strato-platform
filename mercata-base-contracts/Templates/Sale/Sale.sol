import <509>;

abstract contract Sale{ 
    string sellersCommonName;
    string purchasersCommonName;
    Asset assetToBeSold;
    string price;

    enum SaleState {
        NONE,
        Created,
        Closed,
        MAX
    }

    enum PaymentType{
        NONE,
        CASH,
        STRAT,
        MAX
    }


    SaleState state;
    PaymentType payment;


    constructor(
        string _purchasersCommonName,
        address _assetToBeSold,
        string _price,
        SaleState _state,
        PaymentType _payment
    ) {
        assetToBeSold = Asset(_assetToBeSold);
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        sellersCommonName = Certificate(account(address(c), "main")).commonName();
        address currentOwner = assetToBeSold.owner;
        currentOwnerName = Certificate(account(address(currentOwner), "main")).commonName();
        require(sellersCommonName == currentOwnerName, "Only the owner of the asset can open a bill of sale");
        purchasersCommonName = _purchasersCommonName;
        price = _price;
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
        string org = Certificate(account(address(c), "main")).organization();
        require(org == sellersOrganization, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == sellersCommonName, err);
    }

    function changeSaleState(SaleState _state) public requireSeller("Change Payment Type"){
        state=_state;
    }

    function changePaymentType(PaymentType _payment) public requireSeller("Change Payment Type"){

        payment=_payment;
    }

    function transferOwnership(string purchasersCommonName, string price) public requireSeller("Transfer Ownership of Asset") {
        assetToBeSold.transferOwnership(purchasersCommonName, price);
        state = SaleState.Closed;
    }
}