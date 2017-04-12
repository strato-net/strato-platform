{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Bloc.Client where

import Data.Proxy
import Servant.Client
import BlockApps.Bloc.API


--------------------------------------------------------------------------------
-- | Contracts
--------------------------------------------------------------------------------

instance MonadContracts ClientM where
  getContracts = client (Proxy @ GetContracts)
  getContractsData = client (Proxy @ GetContractsData)
  getContractsContract = client (Proxy @ GetContractsContract)
  getContractsState = client (Proxy @ GetContractsState)
  getContractsFunctions = client (Proxy @ GetContractsFunctions)
  getContractsSymbols = client (Proxy @ GetContractsSymbols)
  getContractsStateMapping = client (Proxy @ GetContractsStateMapping)
  getContractsStates = client (Proxy @ GetContractsStates)
  postContractsCompile = client (Proxy @ PostContractsCompile)

--------------------------------------------------------------------------------
-- | Addresses
--------------------------------------------------------------------------------

instance MonadAddresses ClientM where
  getAddresses = client (Proxy @ GetAddresses)

--------------------------------------------------------------------------------
-- | Search
--------------------------------------------------------------------------------

instance MonadSearchContract ClientM where
  getSearchContract = client (Proxy @ GetSearchContract)
  getSearchContractState = client (Proxy @ GetSearchContractState)
  getSearchContractStateReduced = client (Proxy @ GetSearchContractStateReduced)

--------------------------------------------------------------------------------
-- | Users
--------------------------------------------------------------------------------

instance MonadUsers ClientM where
  getUsers = client (Proxy @ GetUsers)
  getUsersUser = client (Proxy @ GetUsersUser)
  postUsersUser = client (Proxy @ PostUsersUser)
  postUsersSend = client (Proxy @ PostUsersSend)
  postUsersContract = client (Proxy @ PostUsersContract)
  postUsersUploadList = client (Proxy @ PostUsersUploadList)
  postUsersContractMethod = client (Proxy @ PostUsersContractMethod)
  postUsersSendList = client (Proxy @ PostUsersSendList)
  postUsersContractMethodList = client (Proxy @ PostUsersContractMethodList)
