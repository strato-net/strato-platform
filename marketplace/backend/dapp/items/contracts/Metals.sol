pragma es6;
pragma strict;

import <a560e2e8d58da359d4df3a1ac2692f38e0be3009>;

contract UnitOfMeasurement {
enum UnitOfMeasurement {
    NULL,
    G,              // Gram
    KG,             // Kilogram
    TROY_OUNCE,     // Troy Ounce
    TROY_POUND,     // Troy Pound
    AVDP_POUND,     // Avoirdupois Pound
    AVDP_OUNCE,     // Avoirdupois Ounce
    TON,            // Metric Ton
    TONNE           // Imperial Ton

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