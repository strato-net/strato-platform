{-# LANGUAGE
    OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Bloc.API.E2ESpec where

import Control.Concurrent
import Data.Either
import qualified Data.Map as Map
import Data.Maybe
import Numeric.Natural
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Users
import BlockApps.Bloc.API.Contracts
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.API.SpecUtils
import BlockApps.Solidity
import BlockApps.Strato.Client
import BlockApps.Strato.Types

-- TODO: user/contract methods Addresses may need to be MayBe Named Address

etherToWei :: Natural -> Natural
etherToWei x = 1000000000000000000 * x

spec :: SpecWith TestConfig
spec = do
  describe "Integration Tests" $ do
    it "should send Ether between two users" $ \ TestConfig {..} -> do
      pendingWith "Skipping until contract E2E works"
      let
          userName1 = UserName "blockapps1"
          userName2 = UserName "blockapps2"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
          postUsersUserRequest2 = PostUsersUserRequest 1 pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      threadDelay 3000000
      postUsersEither2 <- runClientM (postUsersUser userName2 postUsersUserRequest2) (ClientEnv mgr blocUrl)
      threadDelay 3000000
      postUsersEither1 `shouldSatisfy` isRight
      postUsersEither2 `shouldSatisfy` isRight
      let
        Right address1 = postUsersEither1
        Right address2 = postUsersEither2
        initialWei = etherToWei 1000
        params1 = accountsFilterParams {qaAddress = Just address1}
        params2 = accountsFilterParams {qaAddress = Just address2}
      accts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl)
      accts2 <- runClientM
        (getAccountsFilter params2)
        (ClientEnv mgr stratoUrl)
      accts1 `shouldSatisfy` isRight
      accts2 `shouldSatisfy` isRight
      let
        Right (account1 : _) = accts1
        Right (account2 : _) = accts2
        balance1 = unStrung (accountBalance account1)
        balance2 = unStrung (accountBalance account2)
      balance1 `shouldBe` initialWei
      balance2 `shouldBe` initialWei
      threadDelay 4000000
      let
        etherToSend = 100
        postSendParameters = PostSendParameters (address2) (etherToWei etherToSend) pw txParams
      postSendEither <- runClientM (postUsersSend userName1 address1 postSendParameters) (ClientEnv mgr blocUrl)
      postSendEither `shouldSatisfy` isRight
      threadDelay 4000000
      accts2AfterSend <- runClientM
        (getAccountsFilter params2)
        (ClientEnv mgr stratoUrl)
      accts2AfterSend `shouldSatisfy` isRight
      let
        Right (account2AS : _) = accts2AfterSend
        balance2AS = unStrung (accountBalance account2AS)
      balance2AS `shouldBe` (initialWei + (etherToWei etherToSend))

    it "should create SimpleStorage contract, call methods and check state" $ \ TestConfig {..} -> do
      pendingWith "Pending until contract method calls is implemented"
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = simpleStorageContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = 0
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      print (show accts1)
      postUsersContractEither <- runClientM (postUsersContract userName1 addr1 postUsersContractRequest) (ClientEnv mgr blocUrl)
      postUsersContractEither `shouldSatisfy` isRight
      let
        Right contractAddr = postUsersContractEither

      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName simpleStorageContractName)
          (Unnamed contractAddr)
        )
        (ClientEnv mgr blocUrl)
      contractStateEither `shouldSatisfy` isRight
      let
        Right contractStateMap = contractStateEither
        mStoredData = Map.lookup "storedData" contractStateMap
      mStoredData `shouldSatisfy` isJust
      let
        Just storedData = mStoredData
      storedData `shouldBe` SolidityValueAsString "0"

      -- call contract store value

      let
        contractName = ContractName simpleStorageContractName
        postUsersContractMethodRequestSet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "set"
          , postuserscontractmethodArgs = Map.singleton "x" (SolidityValueAsString "3")
          , postuserscontractmethodValue = 0
          }
      postUsersContractMethodEitherSet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight

      -- call get value and verify

      let
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = 0
          }
      postUsersContractMethodEitherGet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right getResponse = postUsersContractMethodEitherGet
      getResponse `shouldBe` PostUsersContractMethodResponse "transaction returned: 3"

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState
          (ContractName simpleStorageContractName)
          (Unnamed contractAddr)
        )
        (ClientEnv mgr blocUrl)
      contractStateEither' `shouldSatisfy` isRight
      let
        Right contractStateMap' = contractStateEither'
        mStoredData' = Map.lookup "storedData" contractStateMap'
      mStoredData' `shouldSatisfy` isJust
      let
        Just storedData' = mStoredData'
      storedData' `shouldBe` SolidityValueAsString "3"

    it "should create SimpleConstructor contract and check state after constructor" $ \ TestConfig {..} -> do
      pendingWith "until state route is implemented"
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
          simpleConstructorName = "SimpleConstructor"
      simpleConstructorSrc <- readSolFile "SimpleConstructor.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleConstructorSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = simpleConstructorName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" "3"
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = 0
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- runClientM (postUsersContract userName1 addr1 postUsersContractRequest) (ClientEnv mgr blocUrl)
      postUsersContractEither `shouldSatisfy` isRight
      let
        Right contractAddr = postUsersContractEither

      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName simpleConstructorName)
          (Unnamed contractAddr)
        )
        (ClientEnv mgr blocUrl)
      contractStateEither `shouldSatisfy` isRight
      let
        Right contractStateMap = contractStateEither
        mStoredData = Map.lookup "storedData" contractStateMap
      mStoredData `shouldSatisfy` isJust
      let
        Just storedData = mStoredData
      storedData `shouldBe` SolidityValueAsString "3"

    it "should create TestArrayStatCons contract and check state after constructor" $ \ TestConfig {..} -> do

      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
          testArrayStatName = "TestArrayStatCons"
      simpleConstructorSrc <- readSolFile "ConstructorTest.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleConstructorSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" "[3,2,3]"
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = 0
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- runClientM (postUsersContract userName1 addr1 postUsersContractRequest) (ClientEnv mgr blocUrl)
      postUsersContractEither `shouldSatisfy` isRight
      let
        Right contractAddr = postUsersContractEither

      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName testArrayStatName)
          (Unnamed contractAddr)
        )
        (ClientEnv mgr blocUrl)
      contractStateEither `shouldSatisfy` isRight
      let
        Right contractStateMap = contractStateEither
        mStoredData = Map.lookup "storedData" contractStateMap
      mStoredData `shouldSatisfy` isJust
      let
        Just storedData = mStoredData
      storedData `shouldBe` SolidityValueAsString "3"
