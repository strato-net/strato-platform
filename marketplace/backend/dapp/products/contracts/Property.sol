/// @title A representation of Property assets
contract Property_0_5 {
    address public productId;
    int public listPrice;
    string public unparsedAddress;
    int public streetNumber;
    string public streetName;
    string public unitNumber;
    string public postalCity;
    string public stateOrProvince;
    int public postalcode;
    int public bathroomsTotalInteger;
    int public bedroomsTotal;
    string public standardStatus;
    int public lotSizeArea;
    string public lotSizeUnits;
    int public livingArea;
    string public livingAreaUnits;
    string public latitude;
    string public longitude;
    int public numberOfUnitsTotal;

    // Appliances
    bool public dishwasher;
    bool public dryer;
    bool public freezer;
    bool public garbageDisposal;
    bool public microwave;
    bool public ovenOrRange;
    bool public refrigerator;
    bool public washer;
    bool public waterHeater;

    // Cooling
    bool public centralAir;
    bool public evaporative;
    bool public geoThermal;
    bool public refrigeration;
    bool public solar;
    bool public wallUnit;

    // Heating
    bool public baseboard;
    bool public forceAir;
    bool public geoThermalHeat;
    bool public heatPump;
    bool public hotWater;
    bool public radiant;
    bool public solarHeat;
    bool public steam;

    // Flooring
    bool public carpet;
    bool public concrete;
    bool public hardwood;
    bool public laminate;
    bool public linoleumVinyl;
    bool public slate;
    bool public softwood;
    bool public tile;

    // Parking
    bool public carport;
    bool public garage;
    bool public offStreet;
    bool public onStreet;

    // Interior Features
    bool public attic;
    bool public cableReady;
    bool public ceilingFan;
    bool public doublePaneWindows;
    bool public elevator;
    bool public fireplace;
    bool public flooring;
    bool public furnished;
    bool public jettedTub;
    bool public securitySystem;
    bool public vaultedCeiling;
    bool public skylight;
    bool public wetBar;

    // Exterior Features
    bool public barbecueArea;
    bool public deck;
    bool public dock;
    bool public fence;
    bool public garden;
    bool public hotTubOrSpa;
    bool public lawn;
    bool public patio;
    bool public pond;
    bool public pool;
    bool public porch;
    bool public rvParking;
    bool public sauna;
    bool public sprinklerSystem;
    bool public waterFront;

    constructor(
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
    ) public {
        productId = _productId;
        listPrice = _listPrice;
        unparsedAddress = _unparsedAddress;
        streetNumber = _streetNumber;
        streetName = _streetName;
        unitNumber = _unitNumber;
        postalCity = _postalCity;
        stateOrProvince = _stateOrProvince;
        postalcode = _postalcode;
        bathroomsTotalInteger = _bathroomsTotalInteger;
        bedroomsTotal = _bedroomsTotal;
        standardStatus = _standardStatus;
        lotSizeArea = _lotSizeArea;
        lotSizeUnits = _lotSizeUnits;
        livingArea = _livingArea;
        livingAreaUnits = _livingAreaUnits;
        latitude = _latitude;
        longitude = _longitude;
        numberOfUnitsTotal = _numberOfUnitsTotal;

        // Appliances
        dishwasher = _dishwasher;
        dryer = _dryer;
        freezer = _freezer;
        garbageDisposal = _garbageDisposal;
        microwave = _microwave;
        ovenOrRange = _ovenOrRange;
        refrigerator = _refrigerator;
        washer = _washer;
        waterHeater = _waterHeater;

        // Cooling
        centralAir = _centralAir;
        evaporative = _evaporative;
        geoThermal = _geoThermal;
        refrigeration = _refrigeration;
        solar = _solar;
        wallUnit = _wallUnit;
        
        // Heating
        baseboard = _baseboard;
        forceAir = _forceAir;
        geoThermalHeat = _geoThermalHeat;
        heatPump = _heatPump;
        hotWater = _hotWater;
        radiant = _radiant;
        solarHeat = _solarHeat;
        steam = _steam;

        // Flooring
        carpet = _carpet;
        concrete = _concrete;
        hardwood = _hardwood;
        laminate = _laminate;
        linoleumVinyl = _linoleumVinyl;
        slate = _slate;
        softwood = _softwood;
        tile = _tile;

        // Parking
        carport = _carport;
        garage = _garage;
        offStreet = _offStreet;
        onStreet = _onStreet;

        // Interior Features
        attic = _attic;
        cableReady = _cableReady;
        ceilingFan = _ceilingFan;
        doublePaneWindows = _doublePaneWindows;
        elevator = _elevator;
        fireplace = _fireplace;
        flooring = _flooring;
        furnished = _furnished;
        jettedTub = _jettedTub;
        securitySystem = _securitySystem;
        vaultedCeiling = _vaultedCeiling;
        skylight = _skylight;
        wetBar = _wetBar;

        // Exterior Features
        barbecueArea = _barbecueArea;
        deck = _deck;
        dock = _dock;
        fence = _fence;
        garden = _garden;
        hotTubOrSpa = _hotTubOrSpa;
        lawn = _lawn;
        patio = _patio;
        pond = _pond;
        pool = _pool;
        porch = _porch;
        rvParking = _rvParking;
        sauna = _sauna;
        sprinklerSystem = _sprinklerSystem;
        waterFront = _waterFront;
        
    }
}
