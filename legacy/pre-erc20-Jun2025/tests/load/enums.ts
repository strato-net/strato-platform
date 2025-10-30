const ba = require('blockapps-rest')

const { rest } = ba
const { config } = ba.common

const { CutResolutionType } = rest.getEnums(`${config.contractsPath}/GasDeal/CutResolutionType.sol`)
const { DealCategory } = rest.getEnums(`${config.contractsPath}/GasDeal/DealCategory.sol`)
const { DealType } = rest.getEnums(`${config.contractsPath}/GasDeal/DealType.sol`)
const { EchoError } = rest.getEnums(`${config.contractsPath}/GasDeal/EchoError.sol`)
const { PriceType } = rest.getEnums(`${config.contractsPath}/GasDeal/PriceType.sol`)
const { TimeZone } = rest.getEnums(`${config.contractsPath}/GasDeal/TimeZone.sol`)
const { RejectionType } = rest.getEnums(`${config.contractsPath}/GasDeal/RejectionType.sol`)

const { GasDealEvent } = rest.getEnums(`${config.contractsPath}/GasDeal/GasDealEvent.sol`)
const { GasDealState } = rest.getEnums(`${config.contractsPath}/GasDeal/GasDealState.sol`)
const { GasVolumeUnits } = rest.getEnums(`${config.contractsPath}/GasDeal/GasVolumeUnits.sol`);

const { PowerDealEvent } = rest.getEnums(`${config.contractsPath}/GasDeal/PowerDealEvent.sol`)
const { PowerDealState } = rest.getEnums(`${config.contractsPath}/GasDeal/PowerDealState.sol`)

const { EchoRole } = rest.getEnums(`${config.contractsPath}/GasDeal/EchoRole.sol`);
const RestStatus = rest.getFields(`${config.contractsPath}/GasDeal/RestStatus.sol`);
const Constants = rest.getFields(`${config.contractsPath}/GasDeal/Constants.sol`);
const { EchoPermission } = rest.getEnums(`${config.contractsPath}/GasDeal/EchoPermission.sol`);
const { Args } = rest.getEnums(`${config.contractsPath}/GasDeal/Args.sol`);

const enums = {
  CutResolutionType,
  DealCategory,
  DealType,
  EchoError,
  TimeZone,
  RejectionType,
  PriceType,
  GasDealEvent,
  GasDealState,
  PowerDealEvent,
  PowerDealState,
  EchoRole,
  RestStatus,
  GasVolumeUnits,
  Constants,
  EchoPermission,
  Args,
}

module.exports = enums
