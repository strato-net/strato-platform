{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc22.API.E2ESpec where


import           Control.Concurrent
import qualified Data.ByteString.Base16           as Base16
import qualified Data.ByteString.Char8            as Char8
import           Data.Either
import qualified Data.Map                         as Map
import           Data.Maybe
import qualified Data.Text.Encoding               as Text
import qualified Data.Text                        as Text
import qualified Data.Vector                      as Vector
import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.SpecUtils
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Client
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Wei

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: SpecWith TestConfig
spec =
  describe "Integration Tests" $ do
    it "should send Ether between two users" $ \ testConfig@TestConfig {..} -> do
      let
          userName1 = UserName "blockapps1"
          userName2 = UserName "blockapps2"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      threadDelay 3000000
      postUsersEither2 <- runClientM (postUsersUser userName2 pw) (ClientEnv mgr blocUrl Nothing)
      threadDelay 3000000
      postUsersEither1 `shouldSatisfy` isRight
      postUsersEither2 `shouldSatisfy` isRight
      let
        Right address1 = postUsersEither1
        Right address2 = postUsersEither2
      postUsersFillEither1 <- runClientM (postUsersFill userName1 address1 True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither2 <- runClientM (postUsersFill userName2 address2 True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither1 `shouldSatisfy` isRight
      postUsersFillEither2 `shouldSatisfy` isRight
      let
        initialWei = 1000000000000000000000
        params1 = accountsFilterParams {qaAddress = Just address1}
        params2 = accountsFilterParams {qaAddress = Just address2}
      accts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl Nothing)
      accts2 <- runClientM
        (getAccountsFilter params2)
        (ClientEnv mgr stratoUrl Nothing)
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
        weiToSend = 100
        postSendParameters = PostSendParameters address2 (Strung weiToSend) pw testTxParams Nothing
      postSendEither <- getResolvedTx testConfig $ runClientM (postUsersSend userName1 address1 Nothing True postSendParameters) (ClientEnv mgr blocUrl Nothing)
      postSendEither `shouldSatisfy` isRight
      threadDelay 4000000
      accts2AfterSend <- runClientM
        (getAccountsFilter params2)
        (ClientEnv mgr stratoUrl Nothing)
      accts2AfterSend `shouldSatisfy` isRight
      let
        Right (account2AS : _) = accts2AfterSend
        balance2AS = unStrung (accountBalance account2AS)
      balance2AS `shouldBe` initialWei + weiToSend

    it "should create SimpleStorage contract, call methods and check state" $ \ testConfig@TestConfig {..} -> do
      let
          userName1 = UserName "blockapps1"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList [("src",simpleStorageSrc),("name", simpleStorageContractName)]
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight
      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails
      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName simpleStorageContractName)
          (Unnamed contractAddr)
          Nothing
          Nothing
          Nothing
          Nothing
          False
        )
        (ClientEnv mgr blocUrl Nothing)
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
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherSet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight

      -- call get value and verify

      let
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherGet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call values))) = postUsersContractMethodEitherGet
      values `shouldBe` [SolidityValueAsString "3"]

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState
          (ContractName simpleStorageContractName)
          (Unnamed contractAddr)
          Nothing
          Nothing
          Nothing
          Nothing
          False
        )
        (ClientEnv mgr blocUrl Nothing)
      contractStateEither' `shouldSatisfy` isRight
      let
        Right contractStateMap' = contractStateEither'
        mStoredData' = Map.lookup "storedData" contractStateMap'
      mStoredData' `shouldSatisfy` isJust
      let
        Just storedData' = mStoredData'
      storedData' `shouldBe` SolidityValueAsString "3"

    it "should create AppMetadata contract and check state" $ \ testConfig@TestConfig {..} -> do
      -- Util Fuctions --
      let createUser un = do
            addr <- fromEither =<<
                    runClientM
                    (postUsersUser un pw)
                    (ClientEnv mgr blocUrl Nothing)
            _ <- fromEither =<<
                 runClientM
                 (postUsersFill un addr True)
                 (ClientEnv mgr blocUrl Nothing)
            threadDelay 4000000
            return addr
      let checkAccount addr = do
            let params = accountsFilterParams {qaAddress = Just addr}
            eAccts <- runClientM
                      (getAccountsFilter params)
                      (ClientEnv mgr stratoUrl Nothing)
            eAccts `shouldSatisfy` isRight
      let createContract fName ctName args un addr = do
            src <- readSolFile fName
            let postUsersContractRequest = PostUsersContractRequest
                  { postuserscontractrequestSrc = src
                  , postuserscontractrequestPassword = pw
                  , postuserscontractrequestContract = Just $ Text.pack ctName
                  , postuserscontractrequestArgs = args
                  , postuserscontractrequestTxParams = testTxParams
                  , postuserscontractrequestValue = Just $ Strung 0
                  , postuserscontractrequestMetadata = Just $ Map.fromList [("src",src),("name",Text.pack ctName)]
                  }
            let clientMethod = postUsersContract
                               un
                               addr
                               Nothing
                               True
                               postUsersContractRequest
            result <- fromEither =<<
                      ( getResolvedTx testConfig $
                        runClientM
                        clientMethod
                        (ClientEnv mgr blocUrl Nothing)
                      )
            let Just (Upload contractDetails) = blocTransactionData result
                Just (Unnamed contractAddr) = contractdetailsAddress contractDetails
            return contractAddr
      let contractState ctName addr = fromEither =<<
                                      runClientM
                                      ( getContractsState
                                        (ContractName ctName)
                                        (Unnamed addr)
                                        Nothing
                                        Nothing
                                        Nothing
                                        Nothing
                                        False
                                      )
                                      (ClientEnv mgr blocUrl Nothing)
      -- Test --
      let userName1 = UserName "blockapps1"
          ctName  = "AppMetadata"
          fName  = "AppMetadata.sol"
          args  = Just $ Map.fromList
                         [ ("_appName", ArgString "TestApp")
                         , ("_version", ArgString "TestVersion")
                         , ("_url", ArgString "TestUrl")
                         , ("_description", ArgString "TestDescription")
                         ]
      addr1 <- createUser userName1
      checkAccount addr1
      contractAddr <- createContract fName ctName args userName1 addr1
      contractStateMap <- contractState (Text.pack ctName) contractAddr
      let mAppName = Map.lookup "appName" contractStateMap
          mVersion = Map.lookup "version" contractStateMap
          mUrl = Map.lookup "url" contractStateMap
          mDescription = Map.lookup "description" contractStateMap
      mAppName `shouldSatisfy` isJust
      mVersion `shouldSatisfy` isJust
      mUrl `shouldSatisfy` isJust
      mDescription `shouldSatisfy` isJust
      let
        Just appName = mAppName
        Just version = mVersion
        Just url = mUrl
        Just description = mDescription
      appName `shouldBe` SolidityValueAsString "TestApp"
      version `shouldBe` SolidityValueAsString "TestVersion"
      url `shouldBe` SolidityValueAsString "TestUrl"
      description `shouldBe` SolidityValueAsString "TestDescription"

    it "should create SimpleStorageAddress contract, call methods and check state" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps999"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
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
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList [("src",simpleStorageAddressSrc),("name",simpleStorageAddressContractName)]
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails

      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName simpleStorageAddressContractName)
          (Unnamed contractAddr)
          Nothing
          Nothing
          Nothing
          Nothing
          False
        )
        (ClientEnv mgr blocUrl Nothing)
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
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherSet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight

      -- call get value and verify

      let
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherGet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call values))) = postUsersContractMethodEitherGet
      values `shouldBe` [SolidityValueAsString "00000000000000000000000000000000deadbeef"]

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState contractName (Unnamed contractAddr) Nothing Nothing Nothing Nothing False)
        (ClientEnv mgr blocUrl Nothing)
      contractStateEither' `shouldSatisfy` isRight

      let
        Right contractStateMap' = contractStateEither'
        mStoredData' = Map.lookup "storedData" contractStateMap'
      mStoredData' `shouldSatisfy` isJust
      let
        Just storedData' = mStoredData'
      storedData' `shouldBe` SolidityValueAsString "00000000000000000000000000000000deadbeef"

    it "should create SimpleStorageBytes32Array contract, call methods and check state" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps444"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      simpleStorageBytes32ArraySrc <- readSolFile "SimpleStorageBytes32Array.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        simpleStorageBytes32ArrayContractName = "SimpleStorageBytes32Array"
        postCompileRequest = PostCompileRequest
          (Just simpleStorageBytes32ArrayContractName)
          simpleStorageBytes32ArraySrc
          Nothing
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageBytes32ArraySrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageBytes32ArrayContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src",simpleStorageBytes32ArraySrc)
              ,("name",simpleStorageBytes32ArrayContractName)
              ]
          }
      _ <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr blocUrl Nothing)
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails

      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName simpleStorageBytes32ArrayContractName)
          (Unnamed contractAddr)
          Nothing
          Nothing
          Nothing
          Nothing
          False
        )
        (ClientEnv mgr blocUrl Nothing)
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
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherSet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight

      -- call get value and verify

      let
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherGet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call values))) = postUsersContractMethodEitherGet
      values `shouldBe`
        [ SolidityArray
          [ SolidityValueAsString (Text.pack $ concat $ replicate 32 "a")
          , SolidityValueAsString (Text.pack $ concat $ replicate 32 "b")
          ]
        ]

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState contractName (Unnamed contractAddr) Nothing Nothing Nothing Nothing False)
        (ClientEnv mgr blocUrl Nothing)
      contractStateEither' `shouldSatisfy` isRight

      let
        Right contractStateMap' = contractStateEither'
        mStoredData' = Map.lookup "storedData" contractStateMap'
      mStoredData' `shouldSatisfy` isJust
      let
        Just storedData' = mStoredData'
      storedData' `shouldBe` SolidityArray
        [ SolidityValueAsString (Text.pack $ concat $ replicate 32 "61")
        , SolidityValueAsString (Text.pack $ concat $ replicate 32 "62")
        ]

    it "should create BytesComboTest contract, call methods and check state" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps444"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      simpleStorageBytes32ArraySrc <- readSolFile "BytesComboTest.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        simpleStorageBytes32ArrayContractName = "BytesComboTest"
        storeArgs =
          [ ("_a1" , ArgString "4d25aa9471ce573fcd260e36255cfbcdd6dd591b")
          , ("_a2" , ArgString "4d25aa9471ce573fcd260e36255cfbcdd6dd591b")
          , ("a" , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89")
          , ("b"
            , ArgArray
                ( Vector.fromList
                  [ ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  ]
                )
            )
          , ("c" , ArgString "Account Data should be able to be as long as you want ideally 12343432442431")
          ]
        postCompileRequest = PostCompileRequest
          (Just simpleStorageBytes32ArrayContractName)
          simpleStorageBytes32ArraySrc
          Nothing
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageBytes32ArraySrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageBytes32ArrayContractName
          , postuserscontractrequestArgs = Just storeArgs
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList [("src", simpleStorageBytes32ArraySrc),("name",simpleStorageBytes32ArrayContractName)]
          }
      _ <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr blocUrl Nothing)
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight



    it "should disambiguate contracts with the same name using latest and address" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      sameName1Src <- readSolFile "SameName1.sol"
      sameName2Src <- readSolFile "SameName2.sol"
      let
        sameName1ContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = sameName1Src
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just "SameName"
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Nothing
          , postuserscontractrequestMetadata = Nothing
          }
        sameName2ContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = sameName2Src
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just "SameName"
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Nothing
          , postuserscontractrequestMetadata = Nothing
          }
      Right (BlocTransactionResult _ _ _ (Just (Upload sameName1Details))) <- getResolvedTx testConfig $ runClientM
        (postUsersContract userName userAddress Nothing True sameName1ContractRequest)
        (ClientEnv mgr blocUrl Nothing)
      Right (BlocTransactionResult _ _ _ (Just (Upload sameName2Details))) <- getResolvedTx testConfig $ runClientM
        (postUsersContract userName userAddress Nothing True sameName2ContractRequest)
        (ClientEnv mgr blocUrl Nothing)
      Right sameName1Symbols <- runClientM
        (getContractsSymbols "SameName" (fromJust $ contractdetailsAddress sameName1Details) Nothing)
        (ClientEnv mgr blocUrl Nothing)
      Right sameName2Symbols <- runClientM
        (getContractsSymbols "SameName" (fromJust $ contractdetailsAddress sameName2Details) Nothing)
        (ClientEnv mgr blocUrl Nothing)
      Right sameNameLatestSymbols <- runClientM
        (getContractsSymbols "SameName" (Named "Latest") Nothing)
        (ClientEnv mgr blocUrl Nothing)
      sameName1Symbols `shouldBe` [SymbolName "myString"]
      sameName2Symbols `shouldBe` [SymbolName "myInt"]
      sameNameLatestSymbols `shouldBe` [SymbolName "myInt"]

    it "should create SimpleConstructor contract and check state after constructor" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps1"

          simpleConstructorName = "SimpleConstructor"
      simpleConstructorSrc <- readSolFile "SimpleConstructor.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleConstructorSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleConstructorName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" (ArgInt 3)
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", simpleConstructorSrc),("name",simpleConstructorName)]
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1 -- todo: uh what?
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight
      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails

      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName simpleConstructorName)
          (Unnamed contractAddr)
          Nothing
          Nothing
          Nothing
          Nothing
          False
        )
        (ClientEnv mgr blocUrl Nothing)
      contractStateEither `shouldSatisfy` isRight
      let
        Right contractStateMap = contractStateEither
        mStoredData = Map.lookup "storedData" contractStateMap
      mStoredData `shouldSatisfy` isJust
      let
        Just storedData = mStoredData
      storedData `shouldBe` SolidityValueAsString "3"

    it "should create TestArrayStatCons contract and check state after constructor" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps1"

          testArrayStatName = "TestArrayStatCons"
      simpleConstructorSrc <- readSolFile "ConstructorTest.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleConstructorSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" (ArgArray (Vector.fromList [ArgInt 3,ArgInt 2,ArgInt 3]))
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", simpleConstructorSrc),("name", testArrayStatName)]
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight


    it "should create TestArrayDynCons contract and check state after constructor" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps1"

          testArrayStatName = "TestArrayDynCons"
      simpleConstructorSrc <- readSolFile "ConstructorTest.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleConstructorSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just $ Map.singleton "x" (ArgArray (Vector.fromList (fmap ArgInt [1,2,3,4,5,6,7,8])))
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", simpleConstructorSrc),("name", testArrayStatName)]
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

    it "should create TestBytesDynCons contract and check state after constructor" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps1"

          testArrayStatName = "TestBytesDynCons"
      simpleConstructorSrc <- readSolFile "ConstructorTest.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleConstructorSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just testArrayStatName
          , postuserscontractrequestArgs = Just . Map.singleton "x" $ ArgString "416c6c207468617420697320676f6c6420646f6573206e6f7420676c69747465722c204e6f7420616c6c2074686f73652077686f2077616e64657220617265206c6f73743b20546865206f6c642074686174206973207374726f6e6720646f6573206e6f74207769746865722c204465657020726f6f747320617265206e6f742072656163686564206279207468652066726f73742e2046726f6d2074686520617368657320612066697265207368616c6c20626520776f6b656e2c2041206c696768742066726f6d2074686520736861646f7773207368616c6c20737072696e673b2052656e65776564207368616c6c2062652074686520626c6164652074686174207761732062726f6b656e2c205468652063726f776e6c65737320616761696e207368616c6c206265206b696e672e"
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", simpleConstructorSrc),("name", testArrayStatName)]
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

    it "should create TestAddressBytesCons contract and check state after constructor" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps1"

          testArrayStatName = "TestAddressBytesCons"
      simpleConstructorSrc <- readSolFile "ConstructorTest.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
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
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", simpleConstructorSrc),("name", testArrayStatName)]
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

    it "should create TestLessComplexCons contract and check state after constructor" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps1"

          testArrayStatName = "TestLessComplexCons"
      simpleConstructorSrc <- readSolFile "ConstructorTest.sol"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
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
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", simpleConstructorSrc),("name", testArrayStatName)]
          }
      eAccts1 <- runClientM
        (getAccountsFilter params1)
        (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

    it "should create SimpleTuple contract, call methods and check state" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps455"

      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
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
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", simpleTupleSrc),("name", simpleTupleContractName)]
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails

      -- get contract state

      contractStateEither <- runClientM
        (getContractsState
          (ContractName simpleTupleContractName)
          (Unnamed contractAddr)
          Nothing
          Nothing
          Nothing
          Nothing
          False
        )
        (ClientEnv mgr blocUrl Nothing)
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
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherSet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight

      -- call get value and verify

      let
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherGet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call values))) = postUsersContractMethodEitherGet
      values `shouldBe` [SolidityValueAsString "2", SolidityValueAsString "4"]

      -- get state and verify

      contractStateEither' <- runClientM
        (getContractsState contractName (Unnamed contractAddr) Nothing Nothing Nothing Nothing False)
        (ClientEnv mgr blocUrl Nothing)
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

    it "should create Bytes32Test contract, call methods and check state" $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps2"
          -- postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
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
          , postuserscontractrequestArgs = Just [("b", ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89")]
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", testSrc'),("name", testContractName')]
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails


      -- -- call contract store value
      let
        argVal =
          [ ("a" , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89")
          , ("c" , ArgString "Account Data should be able to be as long as you want ideally 12343432442431")
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
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherSet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call vs))) = postUsersContractMethodEitherSet
      vs `shouldBe` [SolidityValueAsString "\129\167ePH\SOn=\154M\241{\159\&6\131\182l\237\169\136\&9\ns\193DlBqs\191j\137"]

      -- call get value and verify

      let
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherGet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractName contractAddr Nothing True postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call values))) = postUsersContractMethodEitherGet
      values `shouldBe` [SolidityValueAsString "\129\167ePH\SOn=\154M\241{\159\&6\131\182l\237\169\136\&9\ns\193DlBqs\191j\137"]

    it "should create StorageBlob contract, call methods " $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps2"
          -- postUsersUserRequest1 = PostUsersUserRequest "1" pw
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      testSrc' <- readSolFile "StorageBlob.sol"
      threadDelay 4000000
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        testContractName' = "StorageDepolyer"
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = testSrc'
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just testContractName'
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", testSrc'),("name", testContractName')]
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails

      -- call get value and verify

      let
        contractNameDeployer = ContractName testContractName'
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "deployBlob"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherGet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractNameDeployer contractAddr Nothing True postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call [SolidityValueAsString storageAddr]))) = postUsersContractMethodEitherGet


      -- -- call contract store value
      let
        storageName = ContractName "StorageBlob"
        argVal =
          [ ("a" , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89")
          , ("c" , ArgString "Account Data should be able to be as long as you want ideally 12343432442431")
          , ("b"
            , ArgArray
                ( Vector.fromList
                  [ ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  ]
                )
            )
          ]
        postUsersContractMethodRequestSet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "set"
          , postuserscontractmethodArgs = argVal
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherSet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 storageName (fromJust . stringAddress . Text.unpack $ storageAddr) Nothing True postUsersContractMethodRequestSet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherSet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call vs))) = postUsersContractMethodEitherSet
      vs `shouldBe` [SolidityValueAsString "Account Data should be able to be as long as you want ideally 12343432442431"]

    it "should create IAM contracts and run them all" $ \ testConfig@TestConfig {..} -> do
      pendingWith "BadgerIam.sol not yet complete"
      let
          iamUsername = UserName "IAM"

      postIAMEither <- runClientM (postUsersUser iamUsername pw) (ClientEnv mgr blocUrl Nothing)
      postIAMEither `shouldSatisfy` isRight
      let
        Right addressIAM = postIAMEither
      postUsersFillEitherIAM <- runClientM (postUsersFill iamUsername addressIAM True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEitherIAM `shouldSatisfy` isRight
      iamBlob <- readSolFile "BadgerIam.sol"
      threadDelay 4000000
      let
        Right iamUserAddr = postIAMEither
        paramsIAM = accountsFilterParams {qaAddress = Just iamUserAddr}
        iamName = "IdentityAccessManager"
        postCompileRequest = PostCompileRequest
          (Just iamName)
          iamBlob
          Nothing
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = iamBlob
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just iamName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", iamBlob),("name", iamName)]
          }
      _ <- runClientM (postContractsCompile [postCompileRequest]) (ClientEnv mgr blocUrl Nothing)
      eAccts2 <- runClientM (getAccountsFilter paramsIAM) (ClientEnv mgr stratoUrl Nothing)
      eAccts2 `shouldSatisfy` isRight
      let
        Right accts2 = eAccts2
      length accts2 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract iamUsername iamUserAddr Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed iamAddr) = contractdetailsAddress contractDetails
        bobName = UserName "bob"
      postBobEither <- runClientM (postUsersUser bobName pw) (ClientEnv mgr blocUrl Nothing)
      postBobEither `shouldSatisfy` isRight
      let
        Right address = postBobEither
      postUsersFillEither <- runClientM (postUsersFill bobName address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      threadDelay 4000000
      let
        Right bobAddr = postBobEither
        args = Map.singleton "userKey" . ArgString . Text.pack . formatAddressWithoutColor $ bobAddr
        contrMethodReq = PostUsersContractMethodRequest pw "createIdentityAgent" args (Just $ Strung 0) Nothing Nothing
      identityAgentEither <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod iamUsername iamUserAddr (ContractName "IdentityAccessManager") iamAddr Nothing True contrMethodReq)
        (ClientEnv mgr blocUrl Nothing)
      identityAgentEither `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call [SolidityArray [SolidityValueAsString storeAddr, _]])))  = identityAgentEither
        cName = ContractName "BasicUserStorage"
        storeArgs =
          [ ("_author" , ArgString "4d25aa9471ce573fcd260e36255cfbcdd6dd591b")
          , ("_hash" , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89")
          , ("_tags"
            , ArgArray
                ( Vector.fromList
                  [ ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  , ArgString "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                  ]
                )
            )
          , ("_contents" , ArgString "Account Data should be able to be as long as you want ideally 12343432442431")
          ]
        storeMethodReq = PostUsersContractMethodRequest pw "writeDataToStorage" storeArgs (Just $ Strung 0) Nothing Nothing
      storeEither <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod iamUsername iamUserAddr cName (fromJust . stringAddress . Text.unpack $ storeAddr) Nothing True storeMethodReq)
        (ClientEnv mgr blocUrl Nothing)
      storeEither `shouldSatisfy` isRight

    it "should create ReturnTuple contract, call methods " $ \ testConfig@TestConfig {..} -> do
      pendingWith "Not yet supported for metadata compile"
      let
          userName1 = UserName "blockapps2"
      postUsersEither1 <- runClientM (postUsersUser userName1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      let
        Right address = postUsersEither1
      postUsersFillEither <- runClientM (postUsersFill userName1 address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight
      returnTupleSrc <- readSolFile "ReturnTuple.sol"
      let
        Right addr1 = postUsersEither1
        params1 = accountsFilterParams {qaAddress = Just addr1}
        testContractName' = "ReturnTuple"
        hash = keccak256ByteString $ keccak256 "foo"
        arghash = ArgString $ Text.decodeUtf8 $ Base16.encode hash
        argcontents = ArgString "foo"
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = returnTupleSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just testContractName'
          , postuserscontractrequestArgs = Just $ Map.fromList
              [("_hash",arghash),("_contents",argcontents)]
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Just $ Map.fromList
              [("src", returnTupleSrc),("name", testContractName')]
          }
      eAccts1 <- runClientM (getAccountsFilter params1) (ClientEnv mgr stratoUrl Nothing)
      eAccts1 `shouldSatisfy` isRight
      let
        Right accts1 = eAccts1
      length accts1 `shouldBe` 1
      postUsersContractEither <- getResolvedTx testConfig $ runClientM (postUsersContract userName1 addr1 Nothing True postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
      postUsersContractEither `shouldSatisfy` isRight

      let
        Right result = postUsersContractEither
        Just (Upload contractDetails) = blocTransactionData result
        Just (Unnamed contractAddr) = contractdetailsAddress contractDetails

      -- call get value and verify

      let
        contractNameDeployer = ContractName testContractName'
        postUsersContractMethodRequestGet = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "getBlobData"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      postUsersContractMethodEitherGet <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName1 addr1 contractNameDeployer contractAddr Nothing True postUsersContractMethodRequestGet)
        (ClientEnv mgr blocUrl Nothing)
      postUsersContractMethodEitherGet `shouldSatisfy` isRight
      let
        Right (BlocTransactionResult _ _ _ (Just (Call returnValues))) = postUsersContractMethodEitherGet
      returnValues `shouldBe`
        [ SolidityValueAsString (Text.pack (Char8.unpack hash))
        , SolidityValueAsString "foo"
        ]
