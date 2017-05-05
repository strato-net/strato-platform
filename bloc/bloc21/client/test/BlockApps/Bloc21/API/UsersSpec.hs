{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc21.API.UsersSpec where

import           Control.Concurrent
import           Data.Either
import qualified Data.Map.Strict              as Map
import qualified Data.Text                    as Text
import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc21.API
import           BlockApps.Bloc21.API.SpecUtils
import           BlockApps.Bloc21.Client
import           BlockApps.Ethereum
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
      postUsersEither <- runClientM (postUsersUser username True pw) (ClientEnv mgr blocUrl)
      postUsersEither `shouldSatisfy` isRight
  describe "postUsersSend" $
    it "should send ethers to another address" $ \ TestConfig {..} -> do
      let
        postSendParameters = PostSendParameters toUserAddress 100 pw txParams
        postSendParametersBad = PostSendParameters (Address 0xddb9fa06155e06d3fcf274b8e0a6680d0dc95370) 100 "12345" txParams
      Right postSend <- runClientM (postUsersSend userName userAddress postSendParameters) (ClientEnv mgr blocUrl)
      postSend `shouldSatisfy` (== Strung 100) . posttransactionValue
      postSendEitherBad <- runClientM (postUsersSend userName userAddress postSendParametersBad) (ClientEnv mgr blocUrl)
      postSendEitherBad `shouldSatisfy` isLeft
  describe "postUsersContract" $
    it "should upload a contract" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        postUsersContractRequest = PostUsersContractRequest
          { postuserscontractrequestSrc = simpleStorageSrc
          , postuserscontractrequestPassword = pw
          , postuserscontractrequestContract = simpleStorageContractName
          , postuserscontractrequestArgs = Nothing
          , postuserscontractrequestTxParams = txParams
          , postuserscontractrequestValue = Just 0
          }
      postUsersContractEither <- runClientM (postUsersContract userName userAddress postUsersContractRequest) (ClientEnv mgr blocUrl)
      postUsersContractEither `shouldSatisfy` isRight
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
          , uploadlistResolve = True
          }
      postUsersUploadEither <- runClientM (postUsersUploadList userName userAddress uploadListRequest) (ClientEnv mgr blocUrl)
      postUsersUploadEither `shouldSatisfy` isRight
  describe "postUsersContractMethod" $
    it "should call a contract method" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        contractName = ContractName simpleStorageContractName
        contractAddress = simpleStorageContractAddress
        postUsersContractMethodRequest = PostUsersContractMethodRequest
          { postuserscontractmethodPassword = pw
          , postuserscontractmethodMethod = "get"
          , postuserscontractmethodArgs = Map.empty
          , postuserscontractmethodValue = 0
          , postuserscontractmethodTxParams = txParams
          }
      Right (PostUsersContractMethodResponse response) <- runClientM
        (postUsersContractMethod userName userAddress contractName contractAddress postUsersContractMethodRequest)
        (ClientEnv mgr blocUrl)
      response `shouldBe` "transaction returned: 0"
  describe "postUsersSendList" $
    it "should post a list of send transactions" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        postSendListRequest = PostSendListRequest
          { postsendlistrequestPassword  = pw
          , postsendlistrequestResolve = True
          , postsendlistrequestTxs = replicate 3
              SendTransaction
              { sendtransactionToAddress = toUserAddress
              , sendtransactionValue = 100
              , sendtransactionTxParams = txParams
              }
          }
      Right balances <- runClientM
        (postUsersSendList userName userAddress postSendListRequest)
        (ClientEnv mgr blocUrl)
      balances `shouldSatisfy` all (\(PostSendListResponse balance) ->
        read (Text.unpack balance) <= (1000000000000000000000 - 300 :: Integer))
  describe "postUsersContractMethodList" $
    it "should call a list of methods" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        postMethodListRequest = PostMethodListRequest
          { postmethodlistrequestPassword = pw
          , postmethodlistrequestResolve = True
          , postmethodlistrequestTxs = replicate 3
              MethodCall
              { methodcallContractName = simpleStorageContractName
              , methodcallContractAddress = simpleStorageContractAddress
              , methodcallMethodName = "get"
              , methodcallArgs = Map.empty
              , methodcallValue = 0
              , methodcallTxParams = txParams
              }
          }
      Right responses <- runClientM
        (postUsersContractMethodList userName userAddress postMethodListRequest)
        (ClientEnv mgr blocUrl)
      responses `shouldSatisfy` all ((== "0") . postmethodlistresponseReturnValue)
