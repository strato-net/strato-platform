 

/// @title A representation of Product assets
contract ProductDocument {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public name;
    string public description;
    string public manufacturer;
    UnitOfMeasurement public unitOfMeasurement;
    string public userUniqueProductCode;
    uint public uniqueProductCode;
    int public leastSellableUnit;
    string public imageKey;
    bool public isActive;
    string public category;
    string public subCategory;
    uint public createdDate;
    bool public isDeleted; 
    bool public isInventoryAvailable;  


    constructor(
            string _name
        ,   string _description
        ,   string _manufacturer
        ,   UnitOfMeasurement _unitOfMeasurement
        ,   string _userUniqueProductCode
        ,   uint _uniqueProductCode
        ,   int _leastSellableUnit
        ,   string _imageKey
        ,   bool _isActive
        ,   string _category
        ,   string _subCategory
        ,   uint _createdDate
        ,   address _owner
    ) public {
        owner = _owner;

        name = _name;
        description = _description;
        manufacturer = _manufacturer;
        unitOfMeasurement = _unitOfMeasurement;
        userUniqueProductCode = _userUniqueProductCode;
        uniqueProductCode = _uniqueProductCode;
        leastSellableUnit = _leastSellableUnit;
        imageKey = _imageKey;
        isActive = _isActive;
        category = _category;
        subCategory = _subCategory;
        createdDate = _createdDate;
        isDeleted = false;
        isInventoryAvailable = false;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }
}
