{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc22.API.ContractsSpec where

import           Data.Either
import qualified Data.Map.Strict              as Map
import           Control.Monad.IO.Class
import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.SpecUtils
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Client
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi

spec :: SpecWith TestConfig
spec = do
  describe "postContractsCompile" $ do
    it "compiles a contract" $ \ TestConfig {..} -> do
      let
        postCompileRequest = PostCompileRequest
          (Just simpleStorageContractName)
          simpleStorageSrc
      Right contracts <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr blocUrl)
      contracts `shouldSatisfy` any
        (\ (PostCompileResponse name _) -> name == simpleStorageContractName)
    it "compiles a Solidity file with two contracts in it" $ \ TestConfig {..} -> do
      let
        postCompileRequest = PostCompileRequest
          (Just twoContractsContractName)
          twoContractsSrc
      Right contracts <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr blocUrl)
      liftIO . putStrLn $ show contracts
      contracts `shouldSatisfy` (== 2) . length
  describe "getContracts" $
    it "gets a list of contracts" $ \ TestConfig {..} -> do
      Right (GetContractsResponse contracts) <- runClientM getContracts (ClientEnv mgr blocUrl)
      let Just addressesCreatedAt1 = Map.lookup simpleStorageContractName contracts
      addressesCreatedAt1 `shouldSatisfy` any
        (\ (AddressCreatedAt _ addr Nothing) -> addr == Unnamed simpleStorageContractAddress)
  describe "getContractsData" $
    it "gets a list of addresses created under the contract name" $ \ TestConfig {..} -> do
      Right addrs <- runClientM (getContractsData $ ContractName simpleStorageContractName) (ClientEnv mgr blocUrl)
      addrs `shouldContain` [Unnamed simpleStorageContractAddress]
  describe "getContractsContract" $ do
    it "get xabi data for an uploaded contracted at a specific address" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsContract
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
          Nothing
        )
        (ClientEnv mgr blocUrl)
      contractsEither `shouldSatisfy` isRight
    it "should also work when mappings are involved" $ \ TestConfig {..} -> do
      pendingWith "Mappings not implemented for Contract Metadata"
  describe "getContractsFunctions" $
    it "get a list of contract functions for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      Right functionNames <- runClientM
        (getContractsFunctions
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
          Nothing
        )
        (ClientEnv mgr blocUrl)
      mapM_ (\v -> elem v functionNames `shouldBe` True)
            [ FunctionName "__getSource__"
            , FunctionName "get"
            , FunctionName "set"
            ]
  describe "getContractsSymbols" $
    it "get a list of contract symbols for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      Right symbols <- runClientM
        (getContractsSymbols
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
          Nothing
        )
        (ClientEnv mgr blocUrl)
      symbols `shouldBe` [SymbolName "storedData"]
  describe "getContractsState" $
    it "get contract state for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      Right contracts <- runClientM
        (getContractsState
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
          Nothing
          Nothing
          Nothing
          Nothing
          False
        )
        (ClientEnv mgr blocUrl)
      contracts `shouldBe` Map.fromList
          [ ("__getContractName__",SolidityValueAsString "function () returns (String)")
          , ("__getSource__",SolidityValueAsString "function () returns (String)")
          , ("get",SolidityValueAsString "function () returns (UInt256)")
          , ("set",SolidityValueAsString "function (UInt256) returns ()")
          , ("storedData",SolidityValueAsString "0")
          ]
  describe "getContractsStateMapping" $
    it "get contract state for a mapping within an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      pendingWith "state mapping endpoint not yet implemented"
  describe "getContractsStates" $
    it "get contract states all uploaded contracts at a specific name" $ \ TestConfig {..} -> do
      pendingWith "contract multiple states endpoint not yet implemented"
