{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc22.API.UsersSpec where

import           Control.Concurrent
import           Control.Monad
import           Data.Maybe
import           Data.Either
import qualified Data.Map.Strict                  as Map
import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.API.SpecUtils
import           BlockApps.Bloc22.Client
import           BlockApps.Ethereum
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types


-- TODO: user/contract methods Addresses may need to be Maybe (Named Address)
spec :: SpecWith TestConfig
spec = do
  describe "getUsers" $
    it "should get a list of users" $ \ TestConfig {..} -> do
      Right users <- runClientM getUsers (ClientEnv mgr blocUrl)
      users `shouldContain` [UserName "testUser1", UserName "testUser2"]
  describe "getUsersUser" $
    it "should get a list of user's addresses" $ \ TestConfig {..} -> do
      Right userAddresses <- runClientM (getUsersUser userName) (ClientEnv mgr blocUrl)
      userAddresses `shouldContain` [userAddress]
  describe "postUsersUser" $
    it "should create and faucet a user address" $ \ TestConfig {..} -> do
      let
        username = "blockapps"
      postUsersEither <- runClientM (postUsersUser username pw) (ClientEnv mgr blocUrl)
      postUsersEither `shouldSatisfy` isRight
      let
        Right address = postUsersEither
      postUsersFillEither <- runClientM (postUsersFill username address True pw) (ClientEnv mgr blocUrl)
      postUsersFillEither `shouldSatisfy` isRight
  describe "postUsersSend" $
    it "should send ethers to another address" $ \ testConfig@TestConfig {..} -> do
      let
        postSendParameters = PostSendParameters toUserAddress (Strung 100) pw txParams
        postSendParametersBad = PostSendParameters (Address 0xddb9fa06155e06d3fcf274b8e0a6680d0dc95370) (Strung 100) "12345" txParams
      Right result <- getResolvedTx testConfig $ runClientM (postUsersSend userName userAddress False postSendParameters) (ClientEnv mgr blocUrl)
      let
        Send postTransaction = fromJust $ blocTransactionData result
      postTransaction `shouldSatisfy` (== Strung 100) . posttransactionValue
      resultBad <- getResolvedTx testConfig $ runClientM (postUsersSend userName userAddress False postSendParametersBad) (ClientEnv mgr blocUrl)
      resultBad `shouldSatisfy` isLeft
  describe "postUsersContract" $
    it "should upload a contract" $ \ testConfig@TestConfig {..} -> do
      threadDelay delay
      let
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just $ Strung 0
          }
      Right result <- getResolvedTx testConfig $ runClientM (postUsersContract userName userAddress False postUsersContractRequest) (ClientEnv mgr blocUrl)
      result `shouldSatisfy` (== Success) . blocTransactionStatus
      result `shouldSatisfy` isJust . blocTransactionTxResult
      result `shouldSatisfy` isJust . blocTransactionData
      let
        --Just txResult = blocTransactionTxResult result
        Just (Upload details) = blocTransactionData result
      contractdetailsName details `shouldSatisfy` (== simpleStorageContractName)

  describe "postUsersUploadList" $
    it "should upload a list of contracts" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        uploadListContracts =
          [ UploadListContract
            { uploadlistcontractContractName = simpleStorageContractName
            , uploadlistcontractArgs = Map.empty
            , uploadlistcontractTxParams = txParams
            , uploadlistcontractValue = Nothing
            }
          , UploadListContract
            { uploadlistcontractContractName = testContractName
            , uploadlistcontractArgs = Map.empty
            , uploadlistcontractTxParams = txParams
            , uploadlistcontractValue = Nothing
            }
          ]
        uploadListRequest = UploadListRequest
          { uploadlistPassword = pw
          , uploadlistContracts = uploadListContracts
          , uploadlistResolve = False
          }
      eResults <- runClientM (postUsersUploadList userName userAddress False uploadListRequest) (ClientEnv mgr blocUrl)
      eResults `shouldSatisfy` isRight
      let
        Right unresolved = eResults
      results <- forM unresolved $ \r -> runClientM (resolveBlocTx r) (ClientEnv mgr blocUrl)
      results `shouldSatisfy` all isRight
  describe "postUsersContractMethod" $
    it "should call a contract method" $ \ testConfig@TestConfig {..} -> do
      threadDelay delay
      let
        contractName = ContractName simpleStorageContractName
        contractAddress = simpleStorageContractAddress
        postUsersContractMethodRequest = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = Just $ Strung 0
          , postuserscontractmethodTxParams = txParams
          }
      Right result <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName userAddress contractName contractAddress False postUsersContractMethodRequest)
        (ClientEnv mgr blocUrl)
      fromJust (blocTransactionData result) `shouldBe` Call [SolidityValueAsString "0"]
  describe "postUsersSendList" $
    it "should post a list of send transactions" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        postSendListRequest = PostSendListRequest
          { postsendlistrequestPassword  = pw
          , postsendlistrequestResolve = False
          , postsendlistrequestTxs = replicate 3
              SendTransaction
              { sendtransactionToAddress = toUserAddress
              , sendtransactionValue = Strung 100
              , sendtransactionTxParams = txParams
              }
          }
      eResults <- runClientM
        (postUsersSendList userName userAddress False postSendListRequest)
        (ClientEnv mgr blocUrl)
      eResults `shouldSatisfy` isRight
      let
        Right unresolved = eResults
      results <- forM unresolved $ \r -> runClientM (resolveBlocTx r) (ClientEnv mgr blocUrl)
      results `shouldSatisfy` all isRight
  describe "postUsersContractMethodList" $
    it "should call a list of methods" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        postMethodListRequest = PostMethodListRequest
          { postmethodlistrequestPassword = pw
          , postmethodlistrequestResolve = False
          , postmethodlistrequestTxs = replicate 3
              MethodCall
              { methodcallContractName = simpleStorageContractName
              , methodcallContractAddress = simpleStorageContractAddress
              , methodcallMethodName = "get"
              , methodcallArgs = Map.empty
              , methodcallValue = Strung 0
              , methodcallTxParams = txParams
              }
          }
      eResults <- runClientM
        (postUsersContractMethodList userName userAddress False postMethodListRequest)
        (ClientEnv mgr blocUrl)
      eResults `shouldSatisfy` isRight
      let
        Right unresolved = eResults
      results <- forM unresolved $ \r -> runClientM (resolveBlocTx r) (ClientEnv mgr blocUrl)
      results `shouldSatisfy` all isRight
