pragma es6;
pragma strict;

import <65774cbfc1e06559e2fd8875287e065d583454a8>;

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
contract Metals is Token, UnitOfMeasurement{
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
    ) Token (
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _symbol,    
        _initialSupply,
        _decimals,
        _metadataContract
        ) 
    {
        metadata.registerMetadataAttribute(address(this), + ",leastSellableUnits: " + string(_leastSellableUnits) + ", source: " + string(_source) + ", purity: " + string(_purity));
    }
}