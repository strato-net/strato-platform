pragma es6;
pragma strict;

import <e5c8511b96a78f9ab8b67d233cc8fc831f6ece36>;

contract UnitOfMeasurement {
enum UnitOfMeasurement {
    NULL,
    TON,
    POUND,
    OUNCE,
    TONNE,
    KG,
    G   
}
}

/// @title A representation of Metals assets
contract Metals is Mintable, UnitOfMeasurement{

    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    //categorical
    UnitOfMeasurement public unitOfMeasurement;
    uint public leastSellableUnits;
    string public source; 
    string purity;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        UnitOfMeasurement _unitOfMeasurement,
        uint _leastSellableUnits,
        string _source,
        string _purity
    ) Mintable (
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity) 
    {
        unitOfMeasurement = _unitOfMeasurement;
        leastSellableUnits = _leastSellableUnits;
        source = _source;
        purity = _purity;
    }

    function mint(uint splitQuantity) internal override returns (UTXO) {
        Metals newAsset = new Metals(name,
                              description, 
                              images, 
                              files, 
                              createdDate, 
                              splitQuantity,
                              unitOfMeasurement,
                              leastSellableUnits,
                              source,
                              purity
                              );
        return UTXO(address(newAsset)); 
}
}