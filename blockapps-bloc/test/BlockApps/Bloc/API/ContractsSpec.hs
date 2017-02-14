{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Bloc.API.ContractsSpec where

import Data.Either
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Contracts
import BlockApps.Bloc.API.Utils

spec :: Spec
spec
  = beforeAll (newManager defaultManagerSettings) $ do
    describe "postContractsCompile" $
      it "compiles a contract" $ \ mgr -> do
        let
          postCompileRequest = PostCompileRequest
            []
            "SimpleStorage"
            "contract SimpleStorage {\
            \    uint storedData;\
            \    function set(uint x) {\
            \        storedData = x;\
            \    }\
            \    function get() returns (uint retVal) {\
            \        return storedData;\
            \    }\
            \}"

        contractsEither <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr tester7)
        contractsEither `shouldSatisfy` isRight
    describe "getContracts" $
      it "gets a list of contracts" $ \ mgr -> do
        contractsEither <- runClientM getContracts (ClientEnv mgr tester7)
        contractsEither `shouldSatisfy` isRight
    describe "getContractsData" $
      it "gets a list of addresses created under the contract name" $ \ mgr -> do
        contractsEither <- runClientM (getContractsData $ ContractName "SimpleStorage") (ClientEnv mgr tester7)
        contractsEither `shouldSatisfy` isRight
    describe "getContractsContract" $
      it "get xabi data for an uploaded contracted at a specific address" $ \ mgr -> do
        contractsEither <- runClientM
          (getContractsContract
            (ContractName "SimpleStorage")
            (Named "SimpleStorage")
          )
          (ClientEnv mgr tester7)
        contractsEither `shouldSatisfy` isRight
    describe "getContractsFunctions" $
      it "get a list of contract functions for an uploaded contracted at a specific address" $ \ mgr -> do
        contractsEither <- runClientM
          (getContractsFunctions
            (ContractName "SimpleStorage")
            (Named "SimpleStorage")
          )
          (ClientEnv mgr tester7)
        contractsEither `shouldSatisfy` isRight
    describe "getContractsSymbols" $
      it "get a list of contract symbols for an uploaded contracted at a specific address" $ \ mgr -> do
        contractsEither <- runClientM
          (getContractsSymbols
            (ContractName "SimpleStorage")
            (Named "SimpleStorage")
          )
          (ClientEnv mgr tester7)
        contractsEither `shouldSatisfy` isRight

  -- describe "getContractsState" $
  --   it "get contract state for an uploaded contracted at a specific address" $ \ mgr -> do
  --     contractsEither <- runClientM
  --       (getContractsState
  --         (ContractName "SimpleStorage")
  --         (Named "SimpleStorage")
  --       )
  --       (ClientEnv mgr tester7)
  --     contractsEither `shouldSatisfy` isRight
