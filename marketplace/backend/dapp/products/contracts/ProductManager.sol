import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Product.sol";
import "./Inventory.sol";
import "./Property.sol";
import "/dapp/products/contracts/UnitOfMeasurement.sol";
import "/dapp/products/contracts/InventoryStatus.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ProductManager is UnitOfMeasurement, InventoryStatus, RestStatus {
    // constructor() public {}
    mapping(string => mapping(uint => address)) orgToUPCToProduct;
    mapping(address => mapping(string => bool))
        private uniqueSerialNumberByProductAddress;

    function addProduct(
        string _name,
        string _description,
        string _manufacturer,
        UnitOfMeasurement _unitOfMeasurement,
        string _userUniqueProductCode,
        uint _uniqueProductCode,
        int _leastSellableUnit,
        string _imageKey,
        bool _isActive,
        string _category,
        string _subCategory,
        uint _createdDate
    ) returns (uint256, address) {
        Product_3 product = new Product_3(
            _name,
            _description,
            _manufacturer,
            _unitOfMeasurement,
            _userUniqueProductCode,
            _uniqueProductCode,
            _leastSellableUnit,
            _imageKey,
            _isActive,
            _category,
            _subCategory,
            _createdDate,
            tx.origin
        );

        string _organization = getOrganization(tx.origin);
        orgToUPCToProduct[_organization][_uniqueProductCode] = address(product);

        return (RestStatus.OK, address(product));
    }

    function updateProduct(
        address _productAddress,
        string _description,
        string _imageKey,
        bool _isActive,
        string _userUniqueProductCode,
        uint _scheme
    ) returns (uint256) {
        Product_3 product = Product_3(_productAddress);
        return
            product.update(
                _description,
                _imageKey,
                _isActive,
                _userUniqueProductCode,
                _scheme
            );
    }

    function deleteProduct(address _productAddress) returns (uint256, string) {
        Product_3 product = Product_3(_productAddress);
        return product.deleteProduct();
    }

    function addInventory(
        address _productAddress,
        int _quantity,
        int _pricePerUnit,
        string _batchId,
        InventoryStatus _status,
        uint _createdDate,
        string[] _serialNumbers
    ) returns (uint256, address) {
        if (_serialNumbers.length == 0) {
            Product_3 product = Product_3(_productAddress);
            return
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _batchId,
                    _status,
                    _createdDate,
                    tx.origin
                );
        } else {
            for (uint256 i = 0; i < _serialNumbers.length; i++) {
                if (
                    uniqueSerialNumberByProductAddress[_productAddress][
                        _serialNumbers[i]
                    ]
                ) {
                    return (RestStatus.CONFLICT, address(0));
                }
            }

            for (uint256 j = 0; j < _serialNumbers.length; j++) {
                uniqueSerialNumberByProductAddress[_productAddress][
                    _serialNumbers[j]
                ] = true;
            }

            Product_3 product = Product_3(_productAddress);
            return
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _batchId,
                    _status,
                    _createdDate,
                    tx.origin
                );
        }
    }

    function updateInventory(
        address _productAddress,
        address _inventory,
        int _pricePerUnit,
        InventoryStatus _status,
        uint _scheme
    ) returns (uint256) {
        Product_3 product = Product_3(_productAddress);
        return
            product.updateInventory(
                _inventory,
                _pricePerUnit,
                _status,
                _scheme
            );
    }

    function updateInventoriesQuantities(
        address[] _inventories,
        int[] _quantities,
        bool _isReduce
    ) returns (uint256) {
        for (uint i = 0; i < _inventories.length; i++) {
            Inventory inventory = Inventory(_inventories[i]);

            if (_isReduce) {
                if (_quantities[i] > inventory.availableQuantity()) {
                    return RestStatus.BAD_REQUEST;
                }
                int quantityToDeduct = inventory.availableQuantity() -
                    _quantities[i];
                inventory.updateQuantity(quantityToDeduct);
            } else {
                int quantityToAdd = inventory.availableQuantity() +
                    _quantities[i];

                if (quantityToAdd > inventory.quantity()) {
                    return RestStatus.BAD_REQUEST;
                }
                inventory.updateQuantity(quantityToAdd);
            }
        }
        return RestStatus.OK;
    }

    function getOrganization(address _owner) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(_owner);
        string ownerOrganization = ownerCert["organization"];

        return ownerOrganization;
    }

    function checkForProduct(
        address _productAddress,
        uint _uniqueProductCode,
        address _owner
    ) public returns (address) {
        string _organization = getOrganization(_owner);

        if (
            orgToUPCToProduct[_organization][_uniqueProductCode] !=
            address(0) &&
            orgToUPCToProduct[_organization][_uniqueProductCode] ==
            address(_productAddress)
        ) {
            return orgToUPCToProduct[_organization][_uniqueProductCode];
        }
        return address(0);
    }

    function addProperty(
        address _productId,
        int _listPrice,
        string _unparsedAddress,
        int _streetNumber,
        string _streetName,
        string _unitNumber,
        string _postalCity,
        string _stateOrProvince,
        int _postalcode,
        int _bathroomsTotalInteger,
        int _bedroomsTotal,
        string _standardStatus,
        int _lotSizeArea,
        string _lotSizeUnits,
        int _livingArea,
        string _livingAreaUnits,
        string _latitude,
        string _longitude,
        int _numberOfUnitsTotal,
        // Appliances
        bool _dishwasher,
        bool _dryer,
        bool _freezer,
        bool _garbageDisposal,
        bool _microwave,
        bool _ovenOrRange,
        bool _refrigerator,
        bool _washer,
        bool _waterHeater,
        // Cooling
        bool _centralAir,
        bool _evaporative,
        bool _geoThermal,
        bool _refrigeration,
        bool _solar,
        bool _wallUnit,
        // Heating
        bool _baseboard,
        bool _forceAir,
        bool _geoThermalHeat,
        bool _heatPump,
        bool _hotWater,
        bool _radiant,
        bool _solarHeat,
        bool _steam,
        // Flooring
        bool _carpet,
        bool _concrete,
        bool _hardwood,
        bool _laminate,
        bool _linoleumVinyl,
        bool _slate,
        bool _softwood,
        bool _tile,
        // Parking
        bool _carport,
        bool _garage,
        bool _offStreet,
        bool _onStreet,
        // Interior Features
        bool _attic,
        bool _cableReady,
        bool _ceilingFan,
        bool _doublePaneWindows,
        bool _elevator,
        bool _fireplace,
        bool _flooring,
        bool _furnished,
        bool _jettedTub,
        bool _securitySystem,
        bool _vaultedCeiling,
        bool _skylight,
        bool _wetBar,
        // Exterior Features
        bool _barbecueArea,
        bool _deck,
        bool _dock,
        bool _fence,
        bool _garden,
        bool _hotTubOrSpa,
        bool _lawn,
        bool _patio,
        bool _pond,
        bool _pool,
        bool _porch,
        bool _rvParking,
        bool _sauna,
        bool _sprinklerSystem,
        bool _waterFront
    ) returns (uint256, address) {
        Property_0_5 property = new Property_0_5(
            _productId,
            _listPrice,
            _unparsedAddress,
            _streetNumber,
            _streetName,
            _unitNumber,
            _postalCity,
            _stateOrProvince,
            _postalcode,
            _bathroomsTotalInteger,
            _bedroomsTotal,
            _standardStatus,
            _lotSizeArea,
            _lotSizeUnits,
            _livingArea,
            _livingAreaUnits,
            _latitude,
            _longitude,
            _numberOfUnitsTotal,
            // Appliances
            _dishwasher,
            _dryer,
            _freezer,
            _garbageDisposal,
            _microwave,
            _ovenOrRange,
            _refrigerator,
            _washer,
            _waterHeater,
            // Cooling
            _centralAir,
            _evaporative,
            _geoThermal,
            _refrigeration,
            _solar,
            _wallUnit,
            // Heating
            _baseboard,
            _forceAir,
            _geoThermalHeat,
            _heatPump,
            _hotWater,
            _radiant,
            _solarHeat,
            _steam,
            // Flooring
            _carpet,
            _concrete,
            _hardwood,
            _laminate,
            _linoleumVinyl,
            _slate,
            _softwood,
            _tile,
            // Parking
            _carport,
            _garage,
            _offStreet,
            _onStreet,
            // Interior Features
            _attic,
            _cableReady,
            _ceilingFan,
            _doublePaneWindows,
            _elevator,
            _fireplace,
            _flooring,
            _furnished,
            _jettedTub,
            _securitySystem,
            _vaultedCeiling,
            _skylight,
            _wetBar,
            // Exterior Features
            _barbecueArea,
            _deck,
            _dock,
            _fence,
            _garden,
            _hotTubOrSpa,
            _lawn,
            _patio,
            _pond,
            _pool,
            _porch,
            _rvParking,
            _sauna,
            _sprinklerSystem,
            _waterFront
        );
        return (RestStatus.OK, address(property));
    }

    function updateProperty(
        address _propertyAddress,
        int _listPrice,
        string _unparsedAddress,
        int _streetNumber,
        string _streetName,
        string _unitNumber,
        string _postalCity,
        string _stateOrProvince,
        int _postalcode,
        int _bathroomsTotalInteger,
        int _bedroomsTotal,
        string _standardStatus,
        int _lotSizeArea,
        string _lotSizeUnits,
        int _livingArea,
        string _livingAreaUnits,
        string _latitude,
        string _longitude,
        int _numberOfUnitsTotal,
        // Appliances
        bool _dishwasher,
        bool _dryer,
        bool _freezer,
        bool _garbageDisposal,
        bool _microwave,
        bool _ovenOrRange,
        bool _refrigerator,
        bool _washer,
        bool _waterHeater,
        // Cooling
        bool _centralAir,
        bool _evaporative,
        bool _geoThermal,
        bool _refrigeration,
        bool _solar,
        bool _wallUnit,
        // Heating
        bool _baseboard,
        bool _forceAir,
        bool _geoThermalHeat,
        bool _heatPump,
        bool _hotWater,
        bool _radiant,
        bool _solarHeat,
        bool _steam,
        // Flooring
        bool _carpet,
        bool _concrete,
        bool _hardwood,
        bool _laminate,
        bool _linoleumVinyl,
        bool _slate,
        bool _softwood,
        bool _tile,
        // Parking
        bool _carport,
        bool _garage,
        bool _offStreet,
        bool _onStreet,
        // Interior Features
        bool _attic,
        bool _cableReady,
        bool _ceilingFan,
        bool _doublePaneWindows,
        bool _elevator,
        bool _fireplace,
        bool _flooring,
        bool _furnished,
        bool _jettedTub,
        bool _securitySystem,
        bool _vaultedCeiling,
        bool _skylight,
        bool _wetBar,
        // Exterior Features
        bool _barbecueArea,
        bool _deck,
        bool _dock,
        bool _fence,
        bool _garden,
        bool _hotTubOrSpa,
        bool _lawn,
        bool _patio,
        bool _pond,
        bool _pool,
        bool _porch,
        bool _rvParking,
        bool _sauna,
        bool _sprinklerSystem,
        bool _waterFront
    ) public returns (uint256) {
        Property_0_5 property = Property_0_5(_propertyAddress);

        return
            property.update(
                _listPrice,
                _unparsedAddress,
                _streetNumber,
                _streetName,
                _unitNumber,
                _postalCity,
                _stateOrProvince,
                _postalcode,
                _bathroomsTotalInteger,
                _bedroomsTotal,
                _standardStatus,
                _lotSizeArea,
                _lotSizeUnits,
                _livingArea,
                _livingAreaUnits,
                _latitude,
                _longitude,
                _numberOfUnitsTotal,
                // Appliances
                _dishwasher,
                _dryer,
                _freezer,
                _garbageDisposal,
                _microwave,
                _ovenOrRange,
                _refrigerator,
                _washer,
                _waterHeater,
                // Cooling
                _centralAir,
                _evaporative,
                _geoThermal,
                _refrigeration,
                _solar,
                _wallUnit,
                // Heating
                _baseboard,
                _forceAir,
                _geoThermalHeat,
                _heatPump,
                _hotWater,
                _radiant,
                _solarHeat,
                _steam,
                // Flooring
                _carpet,
                _concrete,
                _hardwood,
                _laminate,
                _linoleumVinyl,
                _slate,
                _softwood,
                _tile,
                // Parking
                _carport,
                _garage,
                _offStreet,
                _onStreet,
                // Interior Features
                _attic,
                _cableReady,
                _ceilingFan,
                _doublePaneWindows,
                _elevator,
                _fireplace,
                _flooring,
                _furnished,
                _jettedTub,
                _securitySystem,
                _vaultedCeiling,
                _skylight,
                _wetBar,
                // Exterior Features
                _barbecueArea,
                _deck,
                _dock,
                _fence,
                _garden,
                _hotTubOrSpa,
                _lawn,
                _patio,
                _pond,
                _pool,
                _porch,
                _rvParking,
                _sauna,
                _sprinklerSystem,
                _waterFront
            );
    }
}
