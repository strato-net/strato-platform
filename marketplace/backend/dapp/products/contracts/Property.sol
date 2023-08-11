import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

/// @title A representation of Property assets
contract Property_0_4 {
    address public productId;
    int public listPrice;
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

    function update(
        int _listPrice,
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
        bool _waterFront,
        uint _scheme
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        if (_scheme == 0) {
            return RestStatus.OK;
        }

        if ((_scheme & (1 << 0)) == (1 << 0)) {
            listPrice = _listPrice;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            streetNumber = _streetNumber;
        }
        if ((_scheme & (1 << 2)) == (1 << 2)) {
            streetName = _streetName;
        }
        if ((_scheme & (1 << 3)) == (1 << 3)) {
            unitNumber = _unitNumber;
        }
        if ((_scheme & (1 << 4)) == (1 << 4)) {
            postalCity = _postalCity;
        }
        if ((_scheme & (1 << 5)) == (1 << 5)) {
            stateOrProvince = _stateOrProvince;
        }
        if ((_scheme & (1 << 6)) == (1 << 6)) {
            postalcode = _postalcode;
        }
        if ((_scheme & (1 << 7)) == (1 << 7)) {
            bathroomsTotalInteger = _bathroomsTotalInteger;
        }
        if ((_scheme & (1 << 8)) == (1 << 8)) {
            bedroomsTotal = _bedroomsTotal;
        }
        if ((_scheme & (1 << 9)) == (1 << 9)) {
            standardStatus = _standardStatus;
        }
        if ((_scheme & (1 << 10)) == (1 << 10)) {
            lotSizeArea = _lotSizeArea;
        }
        if ((_scheme & (1 << 11)) == (1 << 11)) {
            lotSizeUnits = _lotSizeUnits;
        }
        if ((_scheme & (1 << 12)) == (1 << 12)) {
            livingArea = _livingArea;
        }
        if ((_scheme & (1 << 13)) == (1 << 13)) {
            livingAreaUnits = _livingAreaUnits;
        }
        if ((_scheme & (1 << 14)) == (1 << 14)) {
            latitude = _latitude;
        }
        if ((_scheme & (1 << 15)) == (1 << 15)) {
            longitude = _longitude;
        }
        if ((_scheme & (1 << 16)) == (1 << 16)) {
            numberOfUnitsTotal = _numberOfUnitsTotal;
        }
        // Appliances
        if ((_scheme & (1 << 17)) == (1 << 17)) {
            dishwasher = _dishwasher;
        }
        if ((_scheme & (1 << 18)) == (1 << 18)) {
            dryer = _dryer;
        }
        if ((_scheme & (1 << 19)) == (1 << 19)) {
            freezer = _freezer;
        }
        if ((_scheme & (1 << 20)) == (1 << 20)) {
            garbageDisposal = _garbageDisposal;
        }
        if ((_scheme & (1 << 21)) == (1 << 21)) {
            microwave = _microwave;
        }
        if ((_scheme & (1 << 22)) == (1 << 22)) {
            ovenOrRange = _ovenOrRange;
        }
        if ((_scheme & (1 << 23)) == (1 << 23)) {
            refrigerator = _refrigerator;
        }
        if ((_scheme & (1 << 24)) == (1 << 24)) {
            washer = _washer;
        }
        if ((_scheme & (1 << 25)) == (1 << 25)) {
            waterHeater = _waterHeater;
        }
        // Cooling
        if ((_scheme & (1 << 26)) == (1 << 26)) {
            centralAir = _centralAir;
        }
        if ((_scheme & (1 << 27)) == (1 << 27)) {
            evaporative = _evaporative;
        }
        if ((_scheme & (1 << 28)) == (1 << 28)) {
            geoThermal = _geoThermal;
        }
        if ((_scheme & (1 << 29)) == (1 << 29)) {
            refrigeration = _refrigeration;
        }
        if ((_scheme & (1 << 30)) == (1 << 30)) {
            solar = _solar;
        }
        if ((_scheme & (1 << 31)) == (1 << 31)) {
            wallUnit = _wallUnit;
        }
        // Heating
        if ((_scheme & (1 << 32)) == (1 << 32)) {
            baseboard = _baseboard;
        }
        if ((_scheme & (1 << 33)) == (1 << 33)) {
            forceAir = _forceAir;
        }
        if ((_scheme & (1 << 34)) == (1 << 34)) {
            geoThermalHeat = _geoThermalHeat;
        }
        if ((_scheme & (1 << 35)) == (1 << 35)) {
            heatPump = _heatPump;
        }
        if ((_scheme & (1 << 36)) == (1 << 36)) {
            hotWater = _hotWater;
        }
        if ((_scheme & (1 << 37)) == (1 << 37)) {
            radiant = _radiant;
        }
        if ((_scheme & (1 << 38)) == (1 << 38)) {
            solarHeat = _solarHeat;
        }
        if ((_scheme & (1 << 39)) == (1 << 39)) {
            steam = _steam;
        }
        // Flooring
        if ((_scheme & (1 << 40)) == (1 << 40)) {
            carpet = _carpet;
        }
        if ((_scheme & (1 << 41)) == (1 << 41)) {
            concrete = _concrete;
        }
        if ((_scheme & (1 << 42)) == (1 << 42)) {
            hardwood = _hardwood;
        }
        if ((_scheme & (1 << 43)) == (1 << 43)) {
            laminate = _laminate;
        }
        if ((_scheme & (1 << 44)) == (1 << 44)) {
            linoleumVinyl = _linoleumVinyl;
        }
        if ((_scheme & (1 << 45)) == (1 << 45)) {
            slate = _slate;
        }
        if ((_scheme & (1 << 46)) == (1 << 46)) {
            softwood = _softwood;
        }
        if ((_scheme & (1 << 47)) == (1 << 47)) {
            tile = _tile;
        }
        // Parking
        if ((_scheme & (1 << 48)) == (1 << 48)) {
            carport = _carport;
        }
        if ((_scheme & (1 << 49)) == (1 << 49)) {
            garage = _garage;
        }
        if ((_scheme & (1 << 50)) == (1 << 50)) {
            offStreet = _offStreet;
        }
        if ((_scheme & (1 << 51)) == (1 << 51)) {
            onStreet = _onStreet;
        }
        // Interior Features
        if ((_scheme & (1 << 52)) == (1 << 52)) {
            attic = _attic;
        }
        if ((_scheme & (1 << 53)) == (1 << 53)) {
            cableReady = _cableReady;
        }
        if ((_scheme & (1 << 54)) == (1 << 54)) {
            ceilingFan = _ceilingFan;
        }
        if ((_scheme & (1 << 55)) == (1 << 55)) {
            doublePaneWindows = _doublePaneWindows;
        }
        if ((_scheme & (1 << 56)) == (1 << 56)) {
            elevator = _elevator;
        }
        if ((_scheme & (1 << 57)) == (1 << 57)) {
            fireplace = _fireplace;
        }
        if ((_scheme & (1 << 58)) == (1 << 58)) {
            flooring = _flooring;
        }
        if ((_scheme & (1 << 59)) == (1 << 59)) {
            furnished = _furnished;
        }
        if ((_scheme & (1 << 60)) == (1 << 60)) {
            jettedTub = _jettedTub;
        }
        if ((_scheme & (1 << 61)) == (1 << 61)) {
            securitySystem = _securitySystem;
        }
        if ((_scheme & (1 << 62)) == (1 << 62)) {
            vaultedCeiling = _vaultedCeiling;
        }
        if ((_scheme & (1 << 63)) == (1 << 63)) {
            skylight = _skylight;
        }
        if ((_scheme & (1 << 64)) == (1 << 64)) {
            wetBar = _wetBar;
        }
        // Exterior Features
        if ((_scheme & (1 << 65)) == (1 << 65)) {
            barbecueArea = _barbecueArea;
        }
        if ((_scheme & (1 << 66)) == (1 << 66)) {
            deck = _deck;
        }
        if ((_scheme & (1 << 67)) == (1 << 67)) {
            dock = _dock;
        }
        if ((_scheme & (1 << 68)) == (1 << 68)) {
            fence = _fence;
        }
        if ((_scheme & (1 << 69)) == (1 << 69)) {
            garden = _garden;
        }
        if ((_scheme & (1 << 70)) == (1 << 70)) {
            hotTubOrSpa = _hotTubOrSpa;
        }
        if ((_scheme & (1 << 71)) == (1 << 71)) {
            lawn = _lawn;
        }
        if ((_scheme & (1 << 72)) == (1 << 72)) {
            patio = _patio;
        }
        if ((_scheme & (1 << 73)) == (1 << 73)) {
            pond = _pond;
        }
        if ((_scheme & (1 << 74)) == (1 << 74)) {
            pool = _pool;
        }
        if ((_scheme & (1 << 75)) == (1 << 75)) {
            porch = _porch;
        }
        if ((_scheme & (1 << 76)) == (1 << 76)) {
            rvParking = _rvParking;
        }
        if ((_scheme & (1 << 77)) == (1 << 77)) {
            sauna = _sauna;
        }
        if ((_scheme & (1 << 78)) == (1 << 78)) {
            sprinklerSystem = _sprinklerSystem;
        }
        if ((_scheme & (1 << 79)) == (1 << 79)) {
            waterFront = _waterFront;
        }

        return RestStatus.OK;
    }
}
