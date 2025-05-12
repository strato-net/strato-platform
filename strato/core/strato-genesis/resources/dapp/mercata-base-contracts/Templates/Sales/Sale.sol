import <509>;
//import "../Assets/Asset.sol";
//import "../Enums/RestStatus.sol";
//import "../Utils/Utils.sol";
//import "../Structs/Structs.sol";

abstract contract record Sale is Ownable, Structs { 

    Asset public assetToBeSold;
    decimal public price;
    uint public quantity;
    PaymentServiceInfo[] public record paymentServices;
    mapping (string => mapping (string => uint)) paymentServicesMap;
    mapping (string => uint) lockedQuantity;
    uint totalLockedQuantity;
    bool isOpen;

    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        require(_quantity > 0, "Quantity must be greater than 0");
        require(assetToBeSold.quantity() >= _quantity, "Cannot sell more units than what are owned.");
        price = _price;
        quantity = _quantity;
        totalLockedQuantity = 0;
        isOpen = true;
    }

    modifier requireSeller(string action) {
        address sellersCommonName = Ownable(assetToBeSold).owner();
        string err = "Only "
                   + string(sellersCommonName)
                   + " can perform "
                   + action
                   + ".";
        require(msg.sender == sellersCommonName, err);
    }

    function getLock (
        string _orderHash,
        address _purchaser
    ) internal returns (string) {
        return keccak256(
            string(this),
            _orderHash,
            string(_purchaser)
        );
    }

    function completeSale( string orderHash, address purchaser ) public virtual returns (uint);

    function automaticTransfer(address _newOwner, decimal _price, uint _quantity, uint _transferNumber) public virtual returns (uint);

    function closeSale() external virtual returns (uint);

    function closeSaleIfEmpty() internal {
        if (quantity == 0 && totalLockedQuantity == 0) {
            close();
            isOpen = false;
        }
    }

    function _closeSale() internal virtual returns (uint) {
        close();
        isOpen = false;
        return RestStatus.OK;
    }

    function close() internal {
    }

    function lockQuantity(
        uint quantityToLock,
        string orderHash,
        address purchaser
    ) public {
        require(quantityToLock <= quantity, "Not enough quantity to lock");
        string lock = getLock(orderHash, purchaser);
        require(lockedQuantity[lock] == 0, "Order has already locked quantity in this asset.");
        quantity -= quantityToLock;
        lockedQuantity[lock] = quantityToLock;
        totalLockedQuantity += quantityToLock;
    }

    function takeLockedQuantity(string orderHash, address purchaser) internal returns (uint) {
        string lock = getLock(orderHash, purchaser);
        uint quantityToUnlock = lockedQuantity[lock];
        require(quantityToUnlock > 0, "There are no quantity to unlock for address " + string(purchaser));
        lockedQuantity[lock] = 0;
        totalLockedQuantity -= quantityToUnlock;
        return quantityToUnlock;
    }

    function getLockedQuantity(string orderHash, address purchaser) public returns (uint) {
        string lock = getLock(orderHash, purchaser);
        return lockedQuantity[lock];
    }

    function unlockQuantity(
        string orderHash,
        address purchaser
    ) requireSeller("unlock quantity") public {
        uint quantityToReturn = takeLockedQuantity(orderHash, purchaser);
        quantity += quantityToReturn;
    }

    function _cancelOrder(
        string orderHash,
        address purchaser
    ) internal returns (uint) {
        unlockQuantity(orderHash, purchaser);
        return RestStatus.OK;
    }

    function _update(
        uint _quantity,
        decimal _price,
        uint _scheme
    ) internal returns (uint) {

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
      }
      return RestStatus.OK;
    }
}
