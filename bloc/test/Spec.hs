{-# LANGUAGE
    OverloadedStrings
#-}

module Main where

import qualified Data.Map.Strict as Map
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import qualified BlockApps.Bloc.API.AddressesSpec as Addresses
import BlockApps.Bloc.API.Contracts
import qualified BlockApps.Bloc.API.ContractsSpec as Contracts
import qualified BlockApps.Bloc.API.SearchSpec as Search
import BlockApps.Bloc.API.Users
import qualified BlockApps.Bloc.API.UsersSpec as Users
import BlockApps.Bloc.API.SpecUtils
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.API.E2ESpec as E2E
import BlockApps.Solidity.Xabi
-- import qualified BlockApps.Bloc.APISpec as API

import BlockApps.Ethereum

main :: IO ()
main = hspec $ do
  -- API.spec
  beforeAll setup $ do
    Addresses.spec
    Contracts.spec
    Search.spec
    Users.spec
    E2E.spec

setup :: IO TestConfig
setup = do
  mgr' <- newManager defaultManagerSettings
  simpleStorageSource <- readSolFile "SimpleStorage.sol"
  testSource <- readSolFile "Test.sol"
  simpleMappingSource <- readSolFile "SimpleMapping.sol"
  let
    testConfig = TestConfig
      { mgr = mgr'
      , blocUrl = localhost
      , stratoUrl = strato
      , userName = "testUser1"
      , userAddress = Address 0x0
      , toUserName = "testUser2"
      , toUserAddress = Address 0x0
      , pw = "1234"
      , simpleStorageContractName = "SimpleStorage"
      , simpleStorageContractAddress = Address 0x0
      , testContractName = "Test"
      , testContractAddress  = Address 0x0
      , simpleMappingContractName = "SimpleMapping"
      , simpleMappingContractAddress = Address 0x0
      , txParams = Just $ TxParams (Just (Gas 10000000000)) (Just (Wei 1)) Nothing
      , simpleStorageSrc = simpleStorageSource
      , testSrc = testSource
      , simpleMappingSrc = simpleMappingSource
      , delay =
          let second = 1000000
          in 6 * second
      }

    postCompileRequest1 = PostCompileRequest [] (simpleStorageContractName testConfig) (simpleStorageSrc testConfig)
    postCompileRequest2 = PostCompileRequest [] (testContractName testConfig) (testSrc testConfig)
    postCompileRequest3 = PostCompileRequest [] (simpleMappingContractName testConfig) (simpleMappingSrc testConfig)
    -- postUsersContractRequest1 = PostUsersContractRequest simpleStorage pw
    uploadListContract1 = UploadListContract
      { uploadlistcontractContractName = simpleStorageContractName testConfig
      , uploadlistcontractArgs = Map.empty
      , uploadlistcontractTxParams = txParams testConfig
      , uploadlistcontractValue = Nothing
      }
    uploadListContract2 = UploadListContract
      { uploadlistcontractContractName = testContractName testConfig
      , uploadlistcontractArgs = Map.empty
      , uploadlistcontractTxParams = txParams testConfig
      , uploadlistcontractValue = Nothing
      }
    uploadListContract3 = UploadListContract
      { uploadlistcontractContractName = simpleMappingContractName testConfig
      , uploadlistcontractArgs = Map.empty
      , uploadlistcontractTxParams = txParams testConfig
      , uploadlistcontractValue = Nothing
      }
    uploadListRequest = UploadListRequest
      { uploadlistPassword = pw testConfig
      , uploadlistContracts = [uploadListContract1,uploadListContract2,uploadListContract3]
      , uploadlistResolve = True
      }
    clients = do
      addr1 <- postUsersUser (userName testConfig) (PostUsersUserRequest 1 (pw testConfig))
      addr2 <- postUsersUser (toUserName testConfig) (PostUsersUserRequest 1 (pw testConfig))
      _ <- postContractsCompile [postCompileRequest1,postCompileRequest2,postCompileRequest3]
      PostUsersUploadListResponse simpleStorageDetails
        : PostUsersUploadListResponse testDetails
        : PostUsersUploadListResponse simpleMappingDetails
        : _ <- postUsersUploadList (userName testConfig) addr1 uploadListRequest
      let
        Just (Unnamed sscAddr) = contractdetailsAddress simpleStorageDetails
        Just (Unnamed tcAddr) = contractdetailsAddress testDetails
        Just (Unnamed smcAddr) = contractdetailsAddress simpleMappingDetails
        config = testConfig
          { userAddress = addr1
          , toUserAddress = addr2
          , simpleStorageContractAddress = sscAddr
          , testContractAddress = tcAddr
          , simpleMappingContractAddress = smcAddr
          }
      return config
  cfgEither <- runClientM clients (ClientEnv mgr' localhost)
  case cfgEither of
    Left err -> fail $ "Failed to bootstrap tests: " ++ show err
    Right cfg -> return cfg

localhost :: BaseUrl
localhost = BaseUrl Http "localhost" 8000 ""
