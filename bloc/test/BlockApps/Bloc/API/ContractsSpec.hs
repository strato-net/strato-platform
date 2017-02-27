{-# LANGUAGE
    OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Bloc.API.ContractsSpec where

import Data.Either
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Contracts
import BlockApps.Bloc.API.Utils

spec :: SpecWith TestConfig
spec = do
  describe "postContractsCompile" $
    it "compiles a contract" $ \ TestConfig {..} -> do
      let
        postCompileRequest = PostCompileRequest
          []
          simpleStorageContractName
          simpleStorageSrc
      contractsEither <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
  describe "getContracts" $
    it "gets a list of contracts" $ \ TestConfig {..} -> do
      contractsEither <- runClientM getContracts (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
  describe "getContractsData" $
    it "gets a list of addresses created under the contract name" $ \ TestConfig {..} -> do
      contractsEither <- runClientM (getContractsData $ ContractName simpleStorageContractName) (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
  describe "getContractsContract" $ do
    it "get xabi data for an uploaded contracted at a specific address" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsContract
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
        )
        (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
    it "should also work when mappings are involved" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsContract
          (ContractName testContractName)
          (Unnamed testContractAddress)
        )
        (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
  describe "getContractsFunctions" $
    it "get a list of contract functions for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsFunctions
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
        )
        (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
  describe "getContractsSymbols" $
    it "get a list of contract symbols for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsSymbols
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
        )
        (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
  describe "getContractsState" $
    it "get contract state for an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsState
          (ContractName simpleStorageContractName)
          (Unnamed simpleStorageContractAddress)
        )
        (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
  describe "getContractsStateMapping" $
    it "get contract state for a mapping within an uploaded contract at a specific address" $ \ TestConfig {..} -> do
      contractsEitherSimple <- runClientM
        (getContractsStateMapping
          (ContractName simpleMappingContractName)
          (Unnamed simpleMappingContractAddress)
          (SymbolName "m")
          "1"
        )
        (ClientEnv mgr url)
      contractsEitherSimple `shouldSatisfy` isRight
      contractsEitherTest <- runClientM
        (getContractsStateMapping
          (ContractName testContractName)
          (Unnamed testContractAddress)
          (SymbolName "tMapping3")
          "1"
        )
        (ClientEnv mgr url)
      contractsEitherTest `shouldSatisfy` isRight
      contractsEitherBool <- runClientM
        (getContractsStateMapping
          (ContractName simpleMappingContractName)
          (Unnamed simpleMappingContractAddress)
          (SymbolName "m2")
          "1"
        )
        (ClientEnv mgr url)
      contractsEitherBool `shouldSatisfy` isRight
  describe "getContractsStates" $
    it "get contract states all uploaded contracts at a specific name" $ \ TestConfig {..} -> do
      contractsEither <- runClientM
        (getContractsStates
          (ContractName simpleMappingContractName)
        )
        (ClientEnv mgr url)
      contractsEither `shouldSatisfy` isRight
