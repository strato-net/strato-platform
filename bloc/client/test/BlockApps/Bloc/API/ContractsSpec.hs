{-# OPTIONS_GHC -fno-warn-orphans #-}

{-# LANGUAGE
    OverloadedStrings
  , RecordWildCards
  , TypeApplications
#-}

module BlockApps.Bloc.API.ContractsSpec where

import Data.Either
import qualified Data.Map.Strict as Map
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Contracts
import BlockApps.Bloc.API.SpecUtils
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Client
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Xabi

spec :: SpecWith TestConfig
spec = do
  describe "postContractsCompile" $
    it "compiles a contract" $ \ TestConfig {..} -> do
      let
        postCompileRequest = PostCompileRequest
          []
          simpleStorageContractName
          simpleStorageSrc
      Right contracts <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr blocUrl)
      contracts `shouldSatisfy` any
        (\ (PostCompileResponse name _) -> name == simpleStorageContractName)
  describe "getContracts" $
    it "gets a list of contracts" $ \ TestConfig {..} -> do
      Right (GetContractsResponse contracts) <- runClientM getContracts (ClientEnv mgr blocUrl)
      let Just addressesCreatedAt1 = Map.lookup simpleStorageContractName contracts
      let Just addressesCreatedAt2 = Map.lookup testContractName contracts
      let Just addressesCreatedAt3 = Map.lookup simpleMappingContractName contracts
      addressesCreatedAt1 `shouldSatisfy` any
        (\ (AddressCreatedAt _ addr) -> addr == Unnamed simpleStorageContractAddress)
      addressesCreatedAt2 `shouldSatisfy` any
        (\ (AddressCreatedAt _ addr) -> addr == Unnamed testContractAddress)
      addressesCreatedAt3 `shouldSatisfy` any
        (\ (AddressCreatedAt _ addr) -> addr == Unnamed simpleMappingContractAddress)
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
        )
        (ClientEnv mgr blocUrl)
      contractsEither `shouldSatisfy` isRight
    it "should also work when mappings are involved" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsContract
          (ContractName testContractName)
          (Unnamed testContractAddress)
        )
        (ClientEnv mgr blocUrl)
      contractsEither `shouldSatisfy` isRight
  describe "getContractsFunctions" $
    it "get a list of contract functions for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      Right functionNames <- runClientM
        (getContractsFunctions
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
        )
        (ClientEnv mgr blocUrl)
      functionNames `shouldBe` [FunctionName "get", FunctionName "set"]
  describe "getContractsSymbols" $
    it "get a list of contract symbols for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      Right symbols <- runClientM
        (getContractsSymbols
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
        )
        (ClientEnv mgr blocUrl)
      symbols `shouldBe` [SymbolName "storedData"]
  describe "getContractsState" $
    it "get contract state for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      Right contracts <- runClientM
        (getContractsState
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
        )
        (ClientEnv mgr blocUrl)
      contracts `shouldBe`
        ( Map.fromList
          [ ("get",SolidityValueAsString "function () returns (UInt256)")
          , ("set",SolidityValueAsString "function (UInt256) returns ()")
          , ("storedData",SolidityValueAsString "0")
          ]
        )
  describe "getContractsStateMapping" $
    it "get contract state for a mapping within an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      pendingWith "state mapping endpoint not yet implemented"
      contractsEitherSimple <- runClientM
        (getContractsStateMapping
          (ContractName simpleMappingContractName)
          (Unnamed simpleMappingContractAddress)
          "m"
          "1"
        )
        (ClientEnv mgr blocUrl)
      contractsEitherSimple `shouldSatisfy` isRight
      contractsEitherTest <- runClientM
        (getContractsStateMapping
          (ContractName testContractName)
          (Unnamed testContractAddress)
          "tMapping3"
          "1"
        )
        (ClientEnv mgr blocUrl)
      contractsEitherTest `shouldSatisfy` isRight
      contractsEitherBool <- runClientM
        (getContractsStateMapping
          (ContractName simpleMappingContractName)
          (Unnamed simpleMappingContractAddress)
          "m2"
          "1"
        )
        (ClientEnv mgr blocUrl)
      contractsEitherBool `shouldSatisfy` isRight
  describe "getContractsStates" $
    it "get contract states all uploaded contracts at a specific name" $ \ TestConfig {..} -> do
      pendingWith "contract multiple states endpoint not yet implemented"
      contractsEither <- runClientM
        (getContractsStates
          (ContractName simpleMappingContractName)
        )
        (ClientEnv mgr blocUrl)
      contractsEither `shouldSatisfy` isRight
