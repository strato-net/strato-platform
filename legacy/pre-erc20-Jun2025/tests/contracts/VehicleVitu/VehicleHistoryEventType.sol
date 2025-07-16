/* pragma solidity ^0.4.8; */

/**
 * Contract contains constant values for History Snapshot events
 */
contract record VehicleHistoryEventType {

  enum VehicleHistoryEventType {
    CONSTRUCTOR,
    SET_TITLE,
    ADD_LIENHOLDER,
    REMOVE_LIENHOLDER,
    ADD_OWNER,
    REMOVE_OWNER,
    UPDATE_VEHICLE_TYPE,
    UPDATE_VEHICLE_YEAR,
    UPDATE_VEHICLE_MAKE,
    UPDATE_VEHICLE_MODEL,
    UPDATE_VEHICLE_STYLE,
    UPDATE_VEHICLE_COLOR,
    UPDATE_VEHICLE_NUMBER,
    PENDING_ADD_LIENHOLDER,
    PENDING_REMOVE_LIENHOLDER,
    UPDATE_REASONS
  }
}