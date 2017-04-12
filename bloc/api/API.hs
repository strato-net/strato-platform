module API where

import BlockApps.Cirrus.Client
import BlockApps.Ethereum
import BlockApps.Solidity.Contract
import BlockApps.Solidity.SolidityValue
import BlockApps.SolidityVarReader
import BlockApps.Solidity.Xabi
import BlockApps.Strato.Client
import BlockApps.Strato.Types
import BlockApps.XAbiConverter

--------------------------------------------------------------------------------
-- | Contracts
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
-- | Search
--------------------------------------------------------------------------------




type BlocAPI =
  -- /users endpoints
       GetUsers
  :<|> PostUsersUser
  :<|> GetUsersUser
  :<|> PostUsersSend
  :<|> PostUsersContract
  :<|> PostUsersUploadList
  :<|> PostUsersContractMethod
  :<|> PostUsersSendList
  :<|> PostUsersContractMethodList
  -- /address endpoints
  :<|> GetAddresses
  -- /contracts endpoints
  :<|> GetContracts
  :<|> GetContractsData
  :<|> GetContractsContract
  :<|> GetContractsState
  :<|> GetContractsFunctions
  :<|> GetContractsSymbols
  :<|> GetContractsStateMapping
  :<|> GetContractsStates
  :<|> PostContractsCompile
  -- /search endpoints
  :<|> GetSearchContract
  :<|> GetSearchContractState
  :<|> GetSearchContractStateReduced
