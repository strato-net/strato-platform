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
      Right users <- runClientM getUsers (ClientEnv mgr blocUrl Nothing)
      users `shouldContain` [UserName "testUser1", UserName "testUser2"]
  describe "getUsersUser" $
    it "should get a list of user's addresses" $ \ TestConfig {..} -> do
      Right userAddresses <- runClientM (getUsersUser userName) (ClientEnv mgr blocUrl Nothing)
      userAddresses `shouldContain` [userAddress]
  describe "postUsersUser" $ do
    it "should create and faucet a user address" $ \ TestConfig {..} -> do
      let
        username = "blockapps"
      postUsersEither <- runClientM (postUsersUser username pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither `shouldSatisfy` isRight
      let
        Right address = postUsersEither
      postUsersFillEither <- runClientM (postUsersFill username address True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither `shouldSatisfy` isRight

    it "should create two new users and faucet both addresses simultaneously" $ \ TestConfig {..} -> do
      let
        username1 = "blockapps1"
        username2 = "blockapps2"
      postUsersEither1 <- runClientM (postUsersUser username1 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither2 <- runClientM (postUsersUser username2 pw) (ClientEnv mgr blocUrl Nothing)
      postUsersEither1 `shouldSatisfy` isRight
      postUsersEither2 `shouldSatisfy` isRight
      let
        Right address1 = postUsersEither1
        Right address2 = postUsersEither2
      postUsersFillEither1 <- runClientM (postUsersFill username1 address1 False) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither2 <- runClientM (postUsersFill username2 address2 True) (ClientEnv mgr blocUrl Nothing)
      postUsersFillEither1 `shouldSatisfy` isRight
      postUsersFillEither2 `shouldSatisfy` isRight
      let
        Right result1 = postUsersFillEither1
        Right result2 = postUsersFillEither2
      eResult1 <- runClientM (getBlocTransactionResult (blocTransactionHash result1) True) (ClientEnv mgr blocUrl Nothing)
      eResult1 `shouldSatisfy` isRight
      let
        Right resolved1 = eResult1
      putStrLn . ("Unresolved faucet transaction 1: " ++) . show . blocTransactionStatus $ result1
      putStrLn . ("Resolved faucet transaction 1: " ++) . show . blocTransactionStatus $ resolved1
      putStrLn . ("Resolved faucet transaction 2: " ++) . show . blocTransactionStatus $ result2
      --result1 `shouldSatisfy` (== Pending) . blocTransactionStatus
      --resolved1 `shouldSatisfy` (== Success) . blocTransactionStatus
      --result2 `shouldSatisfy` (== Failure) . blocTransactionStatus
  describe "postUsersSend" $ do
    it "should send ethers to another address" $ \ testConfig@TestConfig {..} -> do
      let
        postSendParameters = PostSendParameters toUserAddress (Strung 100) pw testTxParams Nothing
        postSendParametersBad = PostSendParameters (Address 0xddb9fa06155e06d3fcf274b8e0a6680d0dc95370) (Strung 100) "12345" testTxParams Nothing
      Right result <- getResolvedTx testConfig $ runClientM (postUsersSend userName userAddress Nothing False postSendParameters) (ClientEnv mgr blocUrl Nothing)
      let
        Send postTransaction = fromJust $ blocTransactionData result
      postTransaction `shouldSatisfy` (== Strung 100) . posttransactionValue
      resultBad <- getResolvedTx testConfig $ runClientM (postUsersSend userName userAddress Nothing False postSendParametersBad) (ClientEnv mgr blocUrl Nothing)
      resultBad `shouldSatisfy` isLeft

    it "should send ethers to another address with low nonce" $ \ testConfig@TestConfig {..} -> do
      let
        postSendParameters = PostSendParameters toUserAddress (Strung 100) pw testTxParamsLowNonce Nothing
      Right result <- getResolvedTx testConfig $ runClientM (postUsersSend userName userAddress Nothing False postSendParameters) (ClientEnv mgr blocUrl Nothing)
      result `shouldSatisfy` (== Failure) . blocTransactionStatus
      putStrLn $ show result
  describe "postUsersContract" $
    it "should upload a contract" $ \ testConfig@TestConfig {..} -> do
      threadDelay delay
      let
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = Just simpleStorageContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = testTxParams
          , postuserscontractrequestValue = Just $ Strung 0
          , postuserscontractrequestMetadata = Nothing
          }
      Right result <- getResolvedTx testConfig $ runClientM (postUsersContract userName userAddress Nothing False postUsersContractRequest) (ClientEnv mgr blocUrl Nothing)
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
            , _uploadlistcontractTxParams = testTxParams
            , uploadlistcontractValue = Nothing
            , uploadlistcontractMetadata = Nothing
            }
          ]
        uploadListRequest = UploadListRequest
          { uploadlistPassword = pw
          , uploadlistContracts = uploadListContracts
          , uploadlistResolve = False
          }
      eResults <- runClientM (postUsersUploadList userName userAddress Nothing False uploadListRequest) (ClientEnv mgr blocUrl Nothing)
      eResults `shouldSatisfy` isRight
      let
        Right unresolved = eResults
      results <- forM unresolved $ \r -> runClientM (resolveBlocTx r) (ClientEnv mgr blocUrl Nothing)
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
          , postuserscontractmethodTxParams = testTxParams
          , postuserscontractmethodMetadata = Nothing
          }
      Right result <- getResolvedTx testConfig $ runClientM
        (postUsersContractMethod userName userAddress contractName contractAddress Nothing False postUsersContractMethodRequest)
        (ClientEnv mgr blocUrl Nothing)
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
              , _sendtransactionTxParams = testTxParams
              , sendtransactionMetadata = Nothing
              }
          }
      eResults <- runClientM
        (postUsersSendList userName userAddress Nothing False postSendListRequest)
        (ClientEnv mgr blocUrl Nothing)
      eResults `shouldSatisfy` isRight
      let
        Right unresolved = eResults
      results <- forM unresolved $ \r -> runClientM (resolveBlocTx r) (ClientEnv mgr blocUrl Nothing)
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
              , _methodcallTxParams = testTxParams
              , methodcallMetadata = Nothing
              }
          }
      eResults <- runClientM
        (postUsersContractMethodList userName userAddress Nothing False postMethodListRequest)
        (ClientEnv mgr blocUrl Nothing)
      eResults `shouldSatisfy` isRight
      let
        Right unresolved = eResults
      results <- forM unresolved $ \r -> runClientM (resolveBlocTx r) (ClientEnv mgr blocUrl Nothing)
      results `shouldSatisfy` all isRight
