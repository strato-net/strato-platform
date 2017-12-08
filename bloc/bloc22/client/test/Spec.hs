{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}

module Main where

import qualified Data.Map.Strict                  as Map
import           Network.HTTP.Client              hiding (Proxy)
import           Servant.Client
import           System.Environment
import           Test.Hspec

import qualified BlockApps.Bloc22.API.AddressesSpec as Addresses
import           BlockApps.Bloc22.API.Contracts
import qualified BlockApps.Bloc22.API.ContractsSpec as Contracts
import           BlockApps.Bloc22.API.E2ESpec       as E2E
import           BlockApps.Bloc22.API.PragmaSpec    as Pragma
import qualified BlockApps.Bloc22.API.SearchSpec    as Search
import           BlockApps.Bloc22.API.SpecUtils
import           BlockApps.Bloc22.API.Users
import qualified BlockApps.Bloc22.API.UsersSpec     as Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Client
import           BlockApps.Ethereum
-- import BlockApps.Bloc22.Server.Utils
import           BlockApps.Solidity.Xabi

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}
{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

main :: IO ()
main = hspec $ do
  -- API.spec
  beforeAll setup $ do
    Addresses.spec
    Pragma.spec
    Contracts.spec
    Search.spec
    Users.spec
    E2E.spec

setup :: IO TestConfig
setup = do
  strato <- maybe (return defaultStrato) parseBaseUrl =<< lookupEnv "STRATO"
  bloc <- maybe (return defaultBloc) parseBaseUrl =<< lookupEnv "BLOC"
  mgr' <- newManager defaultManagerSettings
  simpleStorageSource <- readSolFile "SimpleStorage.sol"
  testSource <- readSolFile "Test.sol"
  simpleMappingSource <- readSolFile "SimpleMapping.sol"
  twoContractsSource <- readSolFile "TwoContracts.sol"
  putStrLn $ "Using Strato URL: " ++ showBaseUrl strato
  putStrLn $ "Using Bloc URL: " ++ showBaseUrl bloc
  let
    testConfig = TestConfig
      { mgr = mgr'
      , blocUrl = bloc
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
      , twoContractsContractName = "C1"
      , twoContractsContractAddress = Address 0x0
      , txParams = Just $ TxParams (Just (Gas 10000000000)) (Just (Wei 1)) Nothing
      , txParamsLowNonce = Just $ TxParams (Just (Gas 10000000000)) (Just (Wei 1)) (Just $ Nonce 0)
      , simpleStorageSrc = simpleStorageSource
      , testSrc = testSource
      , simpleMappingSrc = simpleMappingSource
      , twoContractsSrc = twoContractsSource
      , delay =
          let second = 1000000
          in 6 * second
      }

    postCompileRequest1 = PostCompileRequest (Just $ simpleStorageContractName testConfig) (simpleStorageSrc testConfig)
    postCompileRequest2 = PostCompileRequest (Just $ testContractName testConfig) (testSrc testConfig)
    postCompileRequest3 = PostCompileRequest (Just $ simpleMappingContractName testConfig) (simpleMappingSrc testConfig)
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
      addr1 <- postUsersUser (userName testConfig) (pw testConfig)
      addr2 <- postUsersUser (toUserName testConfig) (pw testConfig)
      _ <- postUsersFill (userName testConfig) addr1 True
      _ <- postUsersFill (userName testConfig) addr2 True
      _ <- postContractsCompile [postCompileRequest1,postCompileRequest2,postCompileRequest3]
      unresolvedResults <- postUsersUploadList (userName testConfig) addr1 True uploadListRequest
      simpleStorageResult
        : testResult
        : simpleMappingResult
        : _ <- sequence $ map resolveBlocTx unresolvedResults
      let
        Just (Upload simpleStorageDetails) = blocTransactionData simpleStorageResult
        Just (Upload testDetails) = blocTransactionData testResult
        Just (Upload simpleMappingDetails) = blocTransactionData simpleMappingResult
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
  cfgEither <- runClientM clients (ClientEnv mgr' bloc)
  case cfgEither of
    Left err  -> fail $ "Failed to bootstrap tests: " ++ show err
    Right cfg -> return cfg

defaultBloc :: BaseUrl
defaultBloc = BaseUrl Http "localhost" 80 "/bloc/v2.2"

defaultStrato :: BaseUrl
defaultStrato = BaseUrl Http "localhost" 80 "/strato-api/eth/v1.2"
