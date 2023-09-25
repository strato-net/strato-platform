abstract contract SellableAsset is OwnedAsset{
    Sale public sale;

    constructor() OwnedAsset() {}

    function createBaseSale( string _purchaserOrganization, string _purchaserCommonName, string _purchasePrice) returns(Sale){
        Sale b = new Sale(
            _purchaserOrganization,
            _purchaserCommonName,
            address(this),
            _purchasePrice
            );
        return b;
    }

    function createSale( string _purchaserOrganization, string _purchaserCommonName, string _purchasePrice) public requireOwner("Create sale") {
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale( _purchaserOrganization, _purchaserCommonName, _purchasePrice);
    }

    function transferOwnership( string _newOwnerOrganization, string _newOwnerCommonName ) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerOrganization = _newOwnerOrganization;
        ownerCommonName = _newOwnerCommonName;
        sale = Sale(address(0));
    }
}

