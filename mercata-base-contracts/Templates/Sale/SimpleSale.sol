contract SimpleSale is Sale{
    constructor(address _assetToBeSold, SaleState _state, PaymentType _payment) Sale(_assetToBeSold, _state, _payment){
    }
}
