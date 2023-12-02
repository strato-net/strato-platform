import "../Sales/Sale.sol";
import "../Assets/Asset.sol";

abstract contract UTXOSale is Sale {
    uint units;
    UTXO createdUTXO;

    constructor(
        address _assetToBeSold,
        PaymentType _payment,
        uint _price
    ) Sale(_assetToBeSold, _price, _payment) {
    }


    function transferOwnership(address _purchasersAddress, uint _orderId) public override requireSeller("Transfer Ownership of Asset") returns (uint) {
        saleOrderID = _orderId;
        purchasersCommonName = getCommonName(_purchasersAddress);
        executeUTXOSale(_purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    // Function to execute the UTXO sale
    function executeUTXOSale(address _purchasersAddress) internal requireSeller("Execute UTXO Sale") {
        // Call splitAsset on the UTXO asset
        createdUTXO = UTXO(UTXO(assetToBeSold).splitAsset(msg.sender, _purchasersAddress));
    }

    function lockUnits(uint unitsToLock) public {
        UTXO(assetToBeSold).lockUnits(msg.sender, unitsToLock);
    }

    function unlockUnits() public {
        UTXO(assetToBeSold).unlockUnits(msg.sender);
    }
}