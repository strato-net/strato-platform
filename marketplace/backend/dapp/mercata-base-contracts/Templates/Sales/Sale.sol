pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Enums/RestStatus.sol";
import "../Enums/SaleState.sol";
import "../Utils/Utils.sol";

abstract contract Sale is PaymentType, SaleState, RestStatus, Utils { 
    address public sellersAddress;
    string public sellersCommonName;
    string public purchasersCommonName;
    Asset public assetToBeSold;
    uint public price;
    uint public saleOrderID;
    SaleState public state;
    PaymentType public payment;


    constructor(
        address _assetToBeSold,
        uint _price,
        PaymentType _payment
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        sellersAddress = assetToBeSold.owner();
        sellersCommonName = assetToBeSold.ownerCommonName();
        purchasersCommonName = "";
        price = _price;
        state = SaleState.Created;
        payment = _payment;
        saleOrderID = 0;
    }

    modifier requireSeller(string action) {
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = getCommonName(msg.sender);
        require(commonName == sellersCommonName, err);
    }

    function changePrice(uint _price) public requireSeller("change price"){
        price=_price;
    }

    function changeSaleState(SaleState _state) public requireSeller("Change Payment Type"){
        state=_state;
    }

    function changePaymentType(PaymentType _payment) public requireSeller("Change Payment Type"){
        payment=_payment;
    }

    // The logic in Asset's transferOwnership function should be immutable, but inherited Sales may alter
    // the functionality of transferOwnership
    function transferOwnership(address _purchasersAddress, uint _orderId) public virtual returns (uint) {
        saleOrderID = _orderId;
        purchasersCommonName = getCommonName(_purchasersAddress);
        assetToBeSold.transferOwnership(_purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }
}