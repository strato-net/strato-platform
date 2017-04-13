{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    OverloadedStrings
  , RecordWildCards
  , TypeApplications
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
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.API.SpecUtils
import BlockApps.Bloc.Client
import BlockApps.Ethereum
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Xabi
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
          , postuserscontractmethodArgs = Map.singleton "x" "3"
          , postuserscontractmethodValue = 0
          , postuserscontractmethodTxParams = txParams
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
          , postuserscontractmethodTxParams = txParams
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
      pendingWith "pending until we can check state"
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


    it "should create TestArrayDynCons contract and check state after constructor" $ \ TestConfig {..} -> do
      pendingWith "pending until we can check state"
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
          testArrayStatName = "TestArrayDynCons"
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
          , postuserscontractrequestArgs = Just $ Map.singleton "x" "[1,2,3,4,5,6,7,8]"
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

    it "should create TestBytesDynCons contract and check state after constructor" $ \ TestConfig {..} -> do
      pendingWith "pending until we can check state"
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
          testArrayStatName = "TestBytesDynCons"
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
          , postuserscontractrequestArgs = Just $ Map.singleton "x" "416c6c207468617420697320676f6c6420646f6573206e6f7420676c69747465722c204e6f7420616c6c2074686f73652077686f2077616e64657220617265206c6f73743b20546865206f6c642074686174206973207374726f6e6720646f6573206e6f74207769746865722c204465657020726f6f747320617265206e6f742072656163686564206279207468652066726f73742e2046726f6d2074686520617368657320612066697265207368616c6c20626520776f6b656e2c2041206c696768742066726f6d2074686520736861646f7773207368616c6c20737072696e673b2052656e65776564207368616c6c2062652074686520626c6164652074686174207761732062726f6b656e2c205468652063726f776e6c65737320616761696e207368616c6c206265206b696e672e"
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

    it "should create TestAddressBytesCons contract and check state after constructor" $ \ TestConfig {..} -> do
      pendingWith "pending until we can check state"
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
          testArrayStatName = "TestAddressBytesCons"
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
          , postuserscontractrequestArgs = Just $ Map.fromList
          [ ("x", "deadbeef")
          , ( "y", "416c6c207468617420697320676f6c6420646f6573206e6f7420676c69747465722c204e6f7420616c6c2074686f73652077686f2077616e64657220617265206c6f73743b20546865206f6c642074686174206973207374726f6e6720646f6573206e6f74207769746865722c204465657020726f6f747320617265206e6f742072656163686564206279207468652066726f73742e2046726f6d2074686520617368657320612066697265207368616c6c20626520776f6b656e2c2041206c696768742066726f6d2074686520736861646f7773207368616c6c20737072696e673b2052656e65776564207368616c6c2062652074686520626c6164652074686174207761732062726f6b656e2c205468652063726f776e6c65737320616761696e207368616c6c206265206b696e672e"
            )
          ]
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

    it "should create TestLessComplexCons contract and check state after constructor" $ \ TestConfig {..} -> do
      pendingWith "pending until we can check state"
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest 1 pw
          testArrayStatName = "TestLessComplexCons"
      simpleConstructorSrc <- readSolFile "ConstructorTest.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      threadDelay 4000000
      let
        txParamsComplex = Just $ TxParams (Just (Gas 100000000000000)) (Just (Wei 1)) Nothing
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleConstructorSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.fromList
          [ ("_uint", "102344")
          , ("_int", "-444444")
          , ("_address", "deadbeef")
          , ("_bool", "true")
          , ("_string", "One Ring to rule them all, One Ring to find them. One Ring to bring them all, and in the darkenss bind them.")
          , ("_bytes32St", "6af83ccf1dabb1a6117ff5ef95a7d3677e4c4cf047dbd3fd8bfccf5e8b1872fb")
          , ("_uintArrSt", "[1,2,3]")
          ]
          , postuserscontractrequestTxParams = txParamsComplex
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
