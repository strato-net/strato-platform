pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

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
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        UnitOfMeasurement _unitOfMeasurement,
        uint _leastSellableUnits,
        string _source,
        string _purity,
        AssetStatus _status,
        address _redemptionService
    ) Mintable (
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity,
        _status,
        _redemptionService
        ) 
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
                              fileNames,
                              createdDate, 
                              splitQuantity,
                              unitOfMeasurement,
                              leastSellableUnits,
                              source,
                              purity,
                              status,
                              address(redemptionService)
                              );
        return UTXO(address(newAsset)); 
}
}