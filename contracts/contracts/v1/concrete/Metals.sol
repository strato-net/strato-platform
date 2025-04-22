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

function getUnitOfMeasurement(UnitOfMeasurement _unitOfMeasurement) public pure returns (string) {
    if (_unitOfMeasurement == UnitOfMeasurement.NULL) {
        return "NULL";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.G) {
        return "G";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.KG) {
        return "KG";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.TROY_OUNCE) {
        return "TROY_OUNCE";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.TROY_POUND) {
        return "TROY_POUND";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.AVDP_POUND) {
        return "AVDP_POUND";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.AVDP_OUNCE) {
        return "AVDP_OUNCE";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.TON) {
        return "TON";
    }
    if (_unitOfMeasurement == UnitOfMeasurement.TONNE) {
        return "TONNE";
    }
    return "NULL";
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
        metadata.registerMetadataAttribute(address(this), + ",leastSellableUnits: " + string(_leastSellableUnits) + "Unit of Measurement: " + getUnitOfMeasurement(_unitOfMeasurement) + ", source: " + string(_source) + ", purity: " + string(_purity));
    }
}