{-# LANGUAGE
    OverloadedStrings
#-}

module Main where

import Control.Monad
import qualified Data.HashMap.Strict as HashMap
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
  beforeAll setup $ do
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
      , blocUrl = bayar4a
      , stratoUrl = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/strato-api/eth/v1.2"
      , userName = UserName "testUser1"
      , userAddress = Address 0x0
      , toUserName = UserName "testUser2"
      , toUserAddress = Address 0x0
      , pw = "1234"
      , simpleStorageContractName = "SimpleStorage"
      , simpleStorageContractAddress = Address 0x0
      , testContractName = "Test"
      , testContractAddress  = Address 0x0
      , simpleMappingContractName = "SimpleMapping"
      , simpleMappingContractAddress = Address 0x0
      , txParams = TxParams 10000000000 1
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
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = txParams testConfig
      }
    uploadListContract2 = UploadListContract
      { uploadlistcontractContractName = testContractName testConfig
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = txParams testConfig
      }
    uploadListContract3 = UploadListContract
      { uploadlistcontractContractName = simpleMappingContractName testConfig
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = txParams testConfig
      }
    uploadListRequest = UploadListRequest
      { uploadlistPassword = pw testConfig
      , uploadlistContracts = [uploadListContract1,uploadListContract2,uploadListContract3]
      , uploadlistResolve = True
      }
    clients = do
      addr1 <- postUsersUser (userName testConfig) (PostUsersUserRequest 1 (pw testConfig))
      addr2 <- postUsersUser (toUserName testConfig) (PostUsersUserRequest 1 (pw testConfig))
      void $ postContractsCompile [postCompileRequest1,postCompileRequest2,postCompileRequest3]
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
  cfgEither <- runClientM clients (ClientEnv mgr' bayar4a)
  case cfgEither of
    Left err -> fail $ "Failed to bootstrap tests: " ++ show err
    Right cfg -> return cfg
