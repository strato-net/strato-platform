{-# OPTIONS_GHC -fno-warn-orphans #-}

{-# LANGUAGE
    TypeApplications

#-}

module BlockApps.BlocClient (ClientM) where
import Data.Proxy
import Servant.Client
import BlockApps.Bloc.API
import BlockApps.Bloc.Server.Users (MonadUsers(..))
import BlockApps.Bloc.Server.Contracts (MonadContracts(..))
import BlockApps.Bloc.Server.Addresses (MonadAddresses(..))
import BlockApps.Bloc.Server.Search (MonadSearchContract(..))

instance MonadAddresses ClientM where
  getAddresses = client (Proxy @ GetAddresses)

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

instance MonadSearchContract ClientM where
  getSearchContract = client (Proxy @ GetSearchContract)
  getSearchContractState = client (Proxy @ GetSearchContractState)
  getSearchContractStateReduced = client (Proxy @ GetSearchContractStateReduced)

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
