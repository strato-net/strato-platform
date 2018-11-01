/* pragma solidity ^0.4.8; */

contract EchoPermission {

  enum EchoPermission {
    GAS_CREATE_DEAL,
    GAS_MODIFY_DEAL,
    GAS_CAN_ADD_PRICE_INDEX,
    POWER_CREATE_DEAL,
    POWER_MODIFY_DEAL,
    TRANSFER_OWNERSHIP_MAP,
    MANAGE_MANAGERS,
    CREATE_USER
  }
}
