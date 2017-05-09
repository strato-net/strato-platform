{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc20.API.E2ESpec where

import           Control.Concurrent
import qualified Data.ByteString.Base16           as Base16
import qualified Data.ByteString.Char8            as Char8
import           Data.Either
import qualified Data.Map                         as Map
import           Data.Maybe
import           Data.Monoid
import qualified Data.Text.Encoding               as Text
import qualified Data.Vector                      as Vector
import           Numeric.Natural
import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc20.API.Contracts
import           BlockApps.Bloc20.API.SpecUtils
import           BlockApps.Bloc20.API.Users
import           BlockApps.Bloc20.API.Utils
import           BlockApps.Bloc20.Client
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

etherToWei :: Natural -> Natural
etherToWei x = 1000000000000000000 * x

spec :: SpecWith TestConfig
spec =
  describe "Integration Tests" $ do
    it "should send Ether between two users" $ \ TestConfig {..} -> do
      let
          userName1 = UserName "blockapps1"
          userName2 = UserName "blockapps2"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
          postUsersUserRequest2 = PostUsersUserRequest "1" pw
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
        postSendParameters = PostSendParameters address2 (etherToWei etherToSend) pw txParams
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
      balance2AS `shouldBe` initialWei + etherToWei etherToSend

    it "should create SimpleStorage contract, call methods and check state" $ \ TestConfig {..} -> do
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl)
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
          , postuserscontractmethodArgs = Map.singleton "x" (ArgInt 3)
          , postuserscontractmethodValue = Just $ Strung 0
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
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      postUsersContractMethodEitherGet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (PostUsersContractMethodResponse values) = postUsersContractMethodEitherGet
      values `shouldBe` "transaction returned: 3"

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

    it "should create SimpleStorageAddress contract, call methods and check state" $ \ TestConfig {..} -> do
      let
          userName1 = UserName "blockapps999"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      simpleStorageAddressSrc <- readSolFile "SimpleStorageAddress.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        simpleStorageAddressContractName = "SimpleStorageAddress"
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageAddressSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageAddressContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl)
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
          (ContractName simpleStorageAddressContractName)
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
      storedData `shouldBe` SolidityValueAsString "0000000000000000000000000000000000000000"

      -- call contract store value
      let
        contractName = ContractName simpleStorageAddressContractName
        postUsersContractMethodRequestSet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "set"
          , postuserscontractmethodArgs = Map.singleton "x" (ArgString "deadbeef")
          , postuserscontractmethodValue = Just $ Strung 0
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
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      postUsersContractMethodEitherGet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (PostUsersContractMethodResponse values) = postUsersContractMethodEitherGet
      values `shouldBe` "transaction returned: 00000000000000000000000000000000deadbeef"

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState contractName (Unnamed contractAddr))
        (ClientEnv mgr blocUrl)
      contractStateEither' `shouldSatisfy` isRight

      let
        Right contractStateMap' = contractStateEither'
        mStoredData' = Map.lookup "storedData" contractStateMap'
      mStoredData' `shouldSatisfy` isJust
      let
        Just storedData' = mStoredData'
      storedData' `shouldBe` SolidityValueAsString "00000000000000000000000000000000deadbeef"

    it "should create SimpleStorageBytes32Array contract, call methods and check state" $ \ TestConfig {..} -> do
      let
          userName1 = UserName "blockapps444"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      simpleStorageBytes32ArraySrc <- readSolFile "SimpleStorageBytes32Array.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        simpleStorageBytes32ArrayContractName = "SimpleStorageBytes32Array"
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageBytes32ArraySrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageBytes32ArrayContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl)
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
          (ContractName simpleStorageBytes32ArrayContractName)
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
      storedData `shouldBe` SolidityArray []

      -- call contract store value
      let
        arg1 = Text.decodeUtf8 (Base16.encode (Char8.replicate 32 'a'))
        arg2 = Text.decodeUtf8 (Base16.encode (Char8.replicate 32 'b'))
        contractName = ContractName simpleStorageBytes32ArrayContractName
        postUsersContractMethodRequestSet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "set"
          , postuserscontractmethodArgs = Map.singleton "x" (ArgArray [ArgString arg1, ArgString arg2])
          , postuserscontractmethodValue = Just $ Strung 0
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
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      postUsersContractMethodEitherGet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (PostUsersContractMethodResponse values) = postUsersContractMethodEitherGet
      values `shouldBe` ("transaction returned: \"" <> arg1 <> "\",\"" <> arg2 <> "\"")

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState contractName (Unnamed contractAddr))
        (ClientEnv mgr blocUrl)
      contractStateEither' `shouldSatisfy` isRight

      let
        Right contractStateMap' = contractStateEither'
        mStoredData' = Map.lookup "storedData" contractStateMap'
      mStoredData' `shouldSatisfy` isJust
      let
        Just storedData' = mStoredData'
      storedData' `shouldBe` SolidityArray
        [ SolidityValueAsString "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        , SolidityValueAsString "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        ]

    it "should disambiguate contracts with the same name using latest and address" $ \ TestConfig {..} -> do
      sameName1Src <- readSolFile "SameName1.sol"
      sameName2Src <- readSolFile "SameName2.sol"
      let
        sameName1ContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = sameName1Src
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just "SameName"
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Nothing
          }
        sameName2ContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = sameName2Src
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just "SameName"
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Nothing
          }
      Right sameName1Addr <- runClientM
        (postUsersContract userName userAddress sameName1ContractRequest)
        (ClientEnv mgr blocUrl)
      Right sameName2Addr <- runClientM
        (postUsersContract userName userAddress sameName2ContractRequest)
        (ClientEnv mgr blocUrl)
      Right sameName1Symbols <- runClientM
        (getContractsSymbols "SameName" (Unnamed sameName1Addr))
        (ClientEnv mgr blocUrl)
      Right sameName2Symbols <- runClientM
        (getContractsSymbols "SameName" (Unnamed sameName2Addr))
        (ClientEnv mgr blocUrl)
      Right sameNameLatestSymbols <- runClientM
        (getContractsSymbols "SameName" (Named "Latest"))
        (ClientEnv mgr blocUrl)
      sameName1Symbols `shouldBe` [SymbolName "myString"]
      sameName2Symbols `shouldBe` [SymbolName "myInt"]
      sameNameLatestSymbols `shouldBe` [SymbolName "myInt"]

    it "should create SimpleConstructor contract and check state after constructor" $ \ TestConfig {..} -> do
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
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
          , postuserscontractrequestContract = Just simpleConstructorName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" (ArgInt 3)
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1 -- todo: uh what?
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
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
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
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" (ArgArray (Vector.fromList [ArgInt 3,ArgInt 2,ArgInt 3]))
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
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
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
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
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" (ArgArray (Vector.fromList (map ArgInt [1,2,3,4,5,6,7,8])))
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
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
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
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
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" $ ArgString "416c6c207468617420697320676f6c6420646f6573206e6f7420676c69747465722c204e6f7420616c6c2074686f73652077686f2077616e64657220617265206c6f73743b20546865206f6c642074686174206973207374726f6e6720646f6573206e6f74207769746865722c204465657020726f6f747320617265206e6f742072656163686564206279207468652066726f73742e2046726f6d2074686520617368657320612066697265207368616c6c20626520776f6b656e2c2041206c696768742066726f6d2074686520736861646f7773207368616c6c20737072696e673b2052656e65776564207368616c6c2062652074686520626c6164652074686174207761732062726f6b656e2c205468652063726f776e6c65737320616761696e207368616c6c206265206b696e672e"
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
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
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
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
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.fromList
          [ ("x", ArgString "deadbeef")
          , ( "y", ArgString  "416c6c207468617420697320676f6c6420646f6573206e6f7420676c69747465722c204e6f7420616c6c2074686f73652077686f2077616e64657220617265206c6f73743b20546865206f6c642074686174206973207374726f6e6720646f6573206e6f74207769746865722c204465657020726f6f747320617265206e6f742072656163686564206279207468652066726f73742e2046726f6d2074686520617368657320612066697265207368616c6c20626520776f6b656e2c2041206c696768742066726f6d2074686520736861646f7773207368616c6c20737072696e673b2052656e65776564207368616c6c2062652074686520626c6164652074686174207761732062726f6b656e2c205468652063726f776e6c65737320616761696e207368616c6c206265206b696e672e"
            )
          ]
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
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
      let
          userName1 = UserName "blockapps1"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
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
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.fromList
          [ ("_uint", ArgInt 102344)
          , ("_int", ArgInt (-444444))
          , ("_address", ArgString "deadbeef")
          , ("_bool", ArgBool True)
          , ("_string", ArgString "One Ring to rule them all, One Ring to find them. One Ring to bring them all, and in the darkenss bind them.")
          , ("_bytes32St", ArgString "6af83ccf1dabb1a6117ff5ef95a7d3677e4c4cf047dbd3fd8bfccf5e8b1872fb")
          , ("_uintArrSt", ArgArray (Vector.fromList [ArgInt 1,ArgInt 2,ArgInt 3]))
          ]
          , postuserscontractrequestTxParams = txParamsComplex
          , postuserscontractrequestValue = Just $ Strung 0
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

    it "should create SimpleTuple contract, call methods and check state" $ \ TestConfig {..} -> do
      let
          userName1 = UserName "blockapps455"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      simpleTupleSrc <- readSolFile "SimpleTuple.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        simpleTupleContractName = "SimpleTuple"
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleTupleSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleTupleContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl)
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
          (ContractName simpleTupleContractName)
          (Unnamed contractAddr)
        )
        (ClientEnv mgr blocUrl)
      contractStateEither `shouldSatisfy` isRight
      let
        Right contractStateMap = contractStateEither
        mStoredData1 = Map.lookup "storedData1" contractStateMap
        mStoredData2 = Map.lookup "storedData2" contractStateMap
      mStoredData1 `shouldSatisfy` isJust
      mStoredData2 `shouldSatisfy` isJust
      let
        Just storedData1 = mStoredData1
        Just storedData2 = mStoredData2
      storedData1 `shouldBe` SolidityValueAsString "0"
      storedData2 `shouldBe` SolidityValueAsString "0"

      -- call contract store value
      let
        argVal1 = 2
        argVal2 = 4
        contractName = ContractName simpleTupleContractName
        postUsersContractMethodRequestSet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "set"
          , postuserscontractmethodArgs = [("argVal1", ArgInt argVal1), ("argVal2", ArgInt argVal2)]
          , postuserscontractmethodValue = Just $ Strung 0
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
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      postUsersContractMethodEitherGet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (PostUsersContractMethodResponse values) = postUsersContractMethodEitherGet
      values `shouldBe` "transaction returned: 2,4"

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState contractName (Unnamed contractAddr))
        (ClientEnv mgr blocUrl)
      contractStateEither' `shouldSatisfy` isRight

      let
        Right contractStateMap' = contractStateEither'
        mStoredData1' = Map.lookup "storedData1" contractStateMap'
        mStoredData2' = Map.lookup "storedData2" contractStateMap'
      mStoredData1' `shouldSatisfy` isJust
      mStoredData2' `shouldSatisfy` isJust
      let
        Just storedData1' = mStoredData1'
        Just storedData2' = mStoredData2'
      storedData1' `shouldBe` SolidityValueAsString "2"
      storedData2' `shouldBe` SolidityValueAsString "4"

    it "should create EnumTest contract, call methods and check state" $ \ TestConfig {..} -> do
      pendingWith "In progress"
      let
          userName1 = UserName "blockapps2"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      enumTestSrc <- readSolFile "EnumTest.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        enumTestContractName = "EnumTest"
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = enumTestSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just enumTestContractName
          , postuserscontractrequestArgs = Just $ Map.singleton "value" (ArgInt 1)
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl)
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
          (ContractName enumTestContractName)
          (Unnamed contractAddr)
        )
        (ClientEnv mgr blocUrl)
      contractStateEither `shouldSatisfy` isRight
      let
        Right contractStateMap = contractStateEither
        mVal = Map.lookup "val" contractStateMap
      mVal `shouldSatisfy` isJust
      let
        Just val = mVal
      val `shouldBe` SolidityValueAsString "1"

      -- call contract store value
      let
        argVal = 2
        contractName = ContractName enumTestContractName
        postUsersContractMethodRequestSet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "set"
          , postuserscontractmethodArgs = Map.singleton "value" (ArgInt argVal)
          , postuserscontractmethodValue = Just $ Strung 0
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
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      postUsersContractMethodEitherGet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (PostUsersContractMethodResponse values) = postUsersContractMethodEitherGet
      values `shouldBe` "transaction returned: 2"

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState contractName (Unnamed contractAddr))
        (ClientEnv mgr blocUrl)
      contractStateEither' `shouldSatisfy` isRight

      let
        Right contractStateMap' = contractStateEither'
        mVal' = Map.lookup "val" contractStateMap'
      mVal' `shouldSatisfy` isJust
      let
        Just val' = mVal'
      val' `shouldBe` SolidityValueAsString "2"


    it "should create Bytes32Test contract, call methods and check state" $ \ TestConfig {..} -> do
      let
          userName1 = UserName "blockapps2"
          postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 postUsersUserRequest1) (ClientEnv mgr blocUrl)
      postUsersEither1 `shouldSatisfy` isRight
      testSrc' <- readSolFile "Bytes32Test.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        testContractName' = "Bytes32Test"
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = testSrc'
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just testContractName'
          , postuserscontractrequestArgs = Just  [("b", ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89")]
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- runClientM (postUsersContract userName1 addr1 postUsersContractRequest) (ClientEnv mgr blocUrl)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right contractAddr = postUsersContractEither


      -- -- call contract store value
      let
        argVal =
          [ ("a" , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89")
          , ("c" , ArgString "Deep roots are not reached by the frost.")
          , ("b"
            , ArgArray
                ( Vector.fromList
                  [ ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  ]
                )
            )
          ]
        contractName = ContractName testContractName'
        postUsersContractMethodRequestSet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "set"
          , postuserscontractmethodArgs = argVal
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      postUsersContractMethodEitherSet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight
      let
        Right (PostUsersContractMethodResponse vs) = postUsersContractMethodEitherSet
      vs `shouldBe` "transaction returned: \"81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89\""

      -- call get value and verify

      let
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      postUsersContractMethodEitherGet <- runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (PostUsersContractMethodResponse values) = postUsersContractMethodEitherGet
      values `shouldBe` "transaction returned: \"81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89\""
