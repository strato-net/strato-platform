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
contract Metals is Asset, MercataMetadata, UnitOfMeasurement{

    MercataMetadata public metadata;

    //categorical
    UnitOfMeasurement public unitOfMeasurement;
    uint public leastSellableUnits;
    string public source; 
    string purity;

    constructor(
        string _name,
        string _symbol,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint256 _initialSupply,
        uint8 _decimals,
        UnitOfMeasurement _unitOfMeasurement,
        uint _leastSellableUnits,
        string _source,
        string _purity,
        address _redemptionService,
        address _metadataContract
    ) Asset (
        _name,
        _symbol,    
        _initialSupply,
        _decimals
        ) 
    {
        unitOfMeasurement = _unitOfMeasurement;
        leastSellableUnits = _leastSellableUnits;
        source = _source;
        purity = _purity;

        metadata = MercataMetadata(_metadataContract);
        metadata.registerMetadata(address(this), _name, _description, _images, _files, _fileNames, _createdDate);
    }

}