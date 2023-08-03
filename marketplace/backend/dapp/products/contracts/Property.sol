
/// @title A representation of Property assets
contract Properties {

  address public produdctId;
  int public parcelNumber;
  int public listPrice;
  string public unparsedAddress;
  string public streetNumber;
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
  string public listAgentsFullName;
  string public listAgentsEmail;
  int public listAgentsPreferredPhone;
  string[] public appliances;
  string[] public cooling;
  string[] public flooring;
  string[] public heating;
  int public numberOfUnitsTotal;
  string[] public parkingFeatures;
  string[] public interiorFeatures;
  string[] public exteriorFeatures;
  string[] public utilities;
  string[] public images;
  
  constructor(
    address _produdctId,
    int _parcelNumber,
    int _listPrice,
    string _unparsedAddress,
    string _streetNumber,
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
    string _listAgentsFullName,
    string _listAgentsEmail,
    int _listAgentsPreferredPhone,
    string[] _appliances,
    string[] _cooling,
    string[] _flooring,
    string[] _heating,
    int _numberOfUnitsTotal,
    string[] _parkingFeatures,
    string[] _interiorFeatures,
    string[] _exteriorFeatures,
    string[] _utilities,
    string[] _images
  ) public {
    produdctId = _produdctId;
    parcelNumber = _parcelNumber;
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
    listAgentsFullName = _listAgentsFullName;
    listAgentsEmail = _listAgentsEmail;
    listAgentsPreferredPhone = _listAgentsPreferredPhone;
    appliances = _appliances;
    cooling = _cooling;
    flooring = _flooring;
    heating = _heating;
    numberOfUnitsTotal = _numberOfUnitsTotal;
    parkingFeatures = _parkingFeatures;
    interiorFeatures = _interiorFeatures;
    exteriorFeatures = _exteriorFeatures;
    utilities = _utilities;
    images = _images;
  }
}