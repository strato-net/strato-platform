/* pragma solidity ^0.4.8; */

import "./Util.sol";
import "./ErrorCodes.sol";
import "./VehicleHistoryEventType.sol";


/**
 * Vehicle root
 */
contract record Vehicle is ErrorCodes, Util, VehicleHistoryEventType {
  uint public timestamp;
  // creator of the contract
  int public updateCounter = -1;

  // vehcile info
  string public vin;
  string public vtype;
  string public year;
  string public make;
  string public model;
  string public style;
  string public color;
  // title info
  uint number;
  uint issueDate;
  // lienHolders Max Limit
  uint lhMaxLimit;
  // owners Max Limit
  uint ownerMaxLimit;
  // Place Holder for pending removeLineHolder
  int internal pendingRemoveLienHolderIndex;
  // Place Holder for pending addLineHolder
  int internal pendingAddLienHolderNumber;

  // Lien Holders
  struct LienHolder {
    uint number;
    string hash;
  }
  LienHolder[] lienHolders;

  struct Owner {
    uint number;
    string hash;
  }
  Owner[] owners;


  function Vehicle(
    string _vin,
    string _vtype,
    string _year,
    string _make,
    string _model,
    string _style,
    string _color
  ) public {
    // validate vin
    if (bytes(_vin).length == 0) {
      throw;
    }
    timestamp = block.timestamp;
    vin = _vin;
    vtype = _vtype;
    year = _year;
    make = _make;
    model = _model;
    style = _style;
    color = _color;
    // Lien Holders max limit
    lhMaxLimit = 4; // FIXME STRATO-797
    // Owners max limit
    ownerMaxLimit = 2; // FIXME STRATO-797

    // snapshot
    addSnapshot(VehicleHistoryEventType.CONSTRUCTOR, '');
    pendingRemoveLienHolderIndex = -1; //FIXME STRATO-797
    pendingAddLienHolderNumber = -1;
    number = 0;
    updateCounter = 0; // search hook
  }

  function setTitle(
    uint _number,
    uint _issueDate,
    uint _lienHolderNumber0,
    string _lienHolderHash0,
    uint _ownerNumber0,
    string _ownerHash0
  ) public returns (ErrorCodes, int) {
    // if title exists - prevent overwrite
    if (number != 0) {
      return(ErrorCodes.INSUFFICIENT_BALANCE, -1);
    }
    // validate owner
    var ownerErrorCode = validateOwner(_ownerNumber0, _ownerHash0);
    if (ownerErrorCode != ErrorCodes.SUCCESS) return (ownerErrorCode, -1);
    // title
    number = _number;
    issueDate = _issueDate;
    // owner mandatory
    var (errorCode, ) = addOwner(_number, _ownerNumber0, _ownerHash0);
    if (errorCode != ErrorCodes.SUCCESS) return (errorCode, -1);
    // LH optional
    if (_lienHolderNumber0 != 0) {
      addLienHolder(_number, _lienHolderNumber0, _lienHolderHash0);
    }
    // snapshot
    addSnapshotUint(VehicleHistoryEventType.SET_TITLE, _number);
    return (ErrorCodes.SUCCESS, ++updateCounter);
  }

  function addLienHolder(
    uint _titleNumber,
    uint _number,
    string _hash
  ) public returns (ErrorCodes, int) {
    // validate
    if (_number == 0 || bytes(_hash).length == 0) {
      return (ErrorCodes.ERROR, -1);
    }
    // validate the titleNumber same as Vehicle TitleNumber
    if (_titleNumber != number) {
      return (ErrorCodes.ERROR, -1);
    }
    // if pendingAddLienHolderNumber exists then shall match w/ pending lienHolder number
    if (pendingAddLienHolderNumber != -1 && int(_number) != pendingAddLienHolderNumber) {
      return (ErrorCodes.NOT_FOUND, -1);
    }
    // Max limit of lienHolders is 4
    if (lienHolders.length >= lhMaxLimit) {
      return (ErrorCodes.ERROR, -1);
    }
    LienHolder memory lienHolder = LienHolder(_number, _hash);
    lienHolders.push(lienHolder);
    // reset pending addLienHolder Number
    pendingAddLienHolderNumber = -1;
    // snapshot
    addSnapshotUint(VehicleHistoryEventType.ADD_LIENHOLDER, _number);
    return (ErrorCodes.SUCCESS, ++updateCounter);
  }

  // function to set pending addLienHolder number
  function pendingAddLienHolder(uint _number) returns(ErrorCodes, int) {
    // return error if pendingLienHolder pkaceholder number is not zero
    if (pendingAddLienHolderNumber != -1 ) {
      return(ErrorCodes.EXISTS, -1);
    }
    // incoming pending LienHolder Number can't be zero
    if (_number == 0) {
      return(ErrorCodes.ERROR, -1);
    }
    // set pending addLienHolder Number
    pendingAddLienHolderNumber = int(_number);
    //snapshot
    addSnapshotUint(VehicleHistoryEventType.PENDING_ADD_LIENHOLDER, _number);
    return(ErrorCodes.SUCCESS, ++updateCounter);
  }

  function addOwner(
    uint _titleNumber,
    uint _number,
    string _hash
  ) public returns (ErrorCodes, int) {
    // validate
    var errorCode =  validateOwner(_number, _hash) ;
    if (errorCode != ErrorCodes.SUCCESS) {
      return (errorCode, -1);
    }
    if (_number == 0 || bytes(_hash).length == 0) {
      return (ErrorCodes.ERROR, -1);
    }
    // validate the titleNumber same as Vehicle TitleNumber
    if (_titleNumber != number) {
      return (ErrorCodes.ERROR, -1);
    }

    // Max limit of owners is 2
    if (owners.length >= ownerMaxLimit) {
      return (ErrorCodes.ERROR, -1);
    }
    Owner memory owner = Owner(_number, _hash);
    owners.push(owner);
    // snapshot
    addSnapshotUint(VehicleHistoryEventType.ADD_OWNER, _number);
    return (ErrorCodes.SUCCESS, ++updateCounter);
  }

  function validateOwner(
    uint _number,
    string _hash
  ) public returns (ErrorCodes) {
    // validate
    if (_number == 0  || bytes(_hash).length == 0) {
      return (ErrorCodes.ERROR);
    }
    return (ErrorCodes.SUCCESS);
  }

  function updateVehicle(
    string _vtype,
    string _year,
    string _make,
    string _model,
    string _style,
    string _color,
    uint _number
  ) public returns (ErrorCodes, int)
  {
    if (bytes(_vtype).length != 0) {
      vtype = _vtype;
      // add snapshot
      addSnapshot(VehicleHistoryEventType.UPDATE_VEHICLE_TYPE, _vtype);
    }
    if (bytes(_year).length != 0) {
      year = _year;
      // add snapshot
      addSnapshot(VehicleHistoryEventType.UPDATE_VEHICLE_YEAR, _year);
    }
    if (bytes(_make).length != 0) {
      make = _make;
      // add snapshot
      addSnapshot(VehicleHistoryEventType.UPDATE_VEHICLE_MAKE, _make);
    }
    if (bytes(_model).length != 0) {
      model = _model;
      // add snapshot
      addSnapshot(VehicleHistoryEventType.UPDATE_VEHICLE_MODEL, _model);
    }
    if (bytes(_style).length != 0) {
      style = _style;
      // add snapshot
      addSnapshot(VehicleHistoryEventType.UPDATE_VEHICLE_STYLE, _style);
    }
    if (bytes(_color).length != 0) {
      color = _color;
      // add snapshot
      addSnapshot(VehicleHistoryEventType.UPDATE_VEHICLE_COLOR, _color);
    }
    if (_number != 0) {
      number = _number;
      // add snapshot
      addSnapshotUint(VehicleHistoryEventType.UPDATE_VEHICLE_NUMBER, _number);
    }

    return(ErrorCodes.SUCCESS, ++updateCounter);
  }

  function updateReasons( string _reasons) public returns (ErrorCodes, int) {
    addSnapshot(VehicleHistoryEventType.UPDATE_REASONS, _reasons);
    return (ErrorCodes.SUCCESS, ++updateCounter);
  }

  /**
   * removeLienHolder() function to remove lienHolder by given Index.
   * It also validates following condition:
   * - Given index should not be greator than or equal to lienHolderIndex Array length
   * @param _index (uint) - lienHolders array index
   * @return ErrorCodes: The Error code
   */
  function removeLienHolder(uint _titleNumber, uint _index) public returns (ErrorCodes, int) {
    // validate the titleNumber same as Vehicle TitleNumber
    if (_titleNumber != number) {
      return (ErrorCodes.ERROR, -1);
    }

    // if pendingRemoveLienHolderIndex exists then shall match index w/ pending lienHolder index
    if (pendingRemoveLienHolderIndex != -1 && int(_index) != pendingRemoveLienHolderIndex) {
      return (ErrorCodes.NOT_FOUND, -1);
    }
    if (_index >= lienHolders.length) {
      return(ErrorCodes.ERROR, -1);
    }
    // To delete the index from lienHolderIndex array
    for (uint lhi = _index; lhi<lienHolders.length-1; lhi++) {
      // shift the indexes towards left by 1
      lienHolders[lhi] = lienHolders[lhi+1];
    }
    // finally delete the last element of the lienHolderIndex array
    delete lienHolders[lienHolders.length-1];
    lienHolders.length--;
    // reset pendingRemoveLienHolderIndex after success Removal of Lienholder
    pendingRemoveLienHolderIndex = -1;
    // snapshot
    addSnapshotUint(VehicleHistoryEventType.REMOVE_LIENHOLDER, _index);
    return (ErrorCodes.SUCCESS, ++updateCounter);
  }

  // function to set pending removeLienHolder Index
  function pendingRemoveLienHolder(uint _index) returns(ErrorCodes, int) {
    // return exists error if already pendingLienHolder is present
    if (pendingRemoveLienHolderIndex != -1 ) {
      return(ErrorCodes.EXISTS, -1);
    }
    // set pending lienHolder Index
    pendingRemoveLienHolderIndex = int(_index);
    //snapshot
    addSnapshotUint(VehicleHistoryEventType.PENDING_REMOVE_LIENHOLDER, _index);
    return(ErrorCodes.SUCCESS, ++updateCounter);
  }
  /**
  * removeOwner() function to remove Owner by given Index.
  * It also validates following condition:
  * - Given index should not be greator than or equal to Owners Array length
  * @param _index (uint) - owners array index
  * @return ErrorCodes: The Error code
  */
  function removeOwner( uint _titleNumber, uint _index) public returns (ErrorCodes, int) {
    // validate the titleNumber same as Vehicle TitleNumber
    if (_titleNumber != number) {
      return (ErrorCodes.ERROR, -1);
    }
    // validate array index
    if (_index >= owners.length) {
      return(ErrorCodes.ERROR, -1);
    }
    // To delete the index from owners array
    for (uint owner = _index; owner<owners.length-1; owner++) {
      // shift the values towards left by 1
      owners[owner] = owners[owner+1];
    }
    // finally delete the last element of the owners array
    delete owners[owners.length-1];
    owners.length--;
    // snapshot
    addSnapshotUint(VehicleHistoryEventType.REMOVE_OWNER, _index);
    return (ErrorCodes.SUCCESS, ++updateCounter);
  }

  //========================================================
  // Snapshot history
  //========================================================
  struct vehicleSnapshot {
    // meta
    uint timestamp;
    VehicleHistoryEventType eventType;
    string eventData;
    // details
    string vin;
    string vtype;
    string year;
    string make;
    string model;
    string style;
    string color;
    // title details
    uint number;
    uint issueDate;
    // pending details
    int pendingAddLienHolderNumber;
    int pendingRemoveLienHolderIndex;
  }

  vehicleSnapshot[] vehicleHistory;
  Owner[][] ownerHistory;
  LienHolder[][] lienHolderHistory;

  function addSnapshot(VehicleHistoryEventType _eventType, string _eventData) private {
    vehicleSnapshot memory snapshot = vehicleSnapshot(
    // header
      block.timestamp,
      _eventType,
      _eventData,
    // vehicle details
      vin,
      vtype,
      year,
      make,
      model,
      style,
      color,
    // title details
      number,
      issueDate,
    // pending
      pendingAddLienHolderNumber,
      pendingRemoveLienHolderIndex
    );

    // save all
    vehicleHistory.push(snapshot);
    ownerHistory.push(owners);
    lienHolderHistory.push(lienHolders);
  }

  function addSnapshotUint(VehicleHistoryEventType _eventType, uint _eventData) private {
    string memory eventDataString = uintToString(_eventData);
    addSnapshot(_eventType, eventDataString);
  }
}
