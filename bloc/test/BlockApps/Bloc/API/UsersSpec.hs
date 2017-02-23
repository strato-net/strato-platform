{-# LANGUAGE
    OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Bloc.API.UsersSpec where

import Control.Concurrent
import qualified Data.HashMap.Strict as HashMap
import Data.Either
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Users
import BlockApps.Bloc.API.Utils
import BlockApps.Ethereum

-- TODO: user/contract methods Addresses may need to be MayBe Named Address

spec :: SpecWith TestConfig
spec = do
  describe "getUsers" $
    it "should get a list of users" $ \ TestConfig {..} -> do
      usersEither <- runClientM getUsers (ClientEnv mgr bayar4a)
      usersEither `shouldSatisfy` isRight
  describe "getUsersUser" $
    it "should get a list of user's addresses" $ \ TestConfig {..} -> do
      userAddressesEither <- runClientM (getUsersUser userName) (ClientEnv mgr bayar4a)
      userAddressesEither `shouldSatisfy` isRight
  describe "postUsersUser" $
    it "should create and faucet a user address" $ \ TestConfig {..} -> do
      let
        username = UserName "blockapps"
        postUsersUserRequest = PostUsersUserRequest 1 pw
      postUsersEither <- runClientM (postUsersUser username postUsersUserRequest) (ClientEnv mgr bayar4a)
      postUsersEither `shouldSatisfy` isRight
  describe "postUsersSend" $
    it "should send ethers to another address" $ \ TestConfig {..} -> do
      let
        postSendParameters = PostSendParameters (toUserAddress) 100 pw
        postSendParametersBad = PostSendParameters (Address 0xddb9fa06155e06d3fcf274b8e0a6680d0dc95370) 100 "12345"
      postSendEither <- runClientM (postUsersSend userName userAddress postSendParameters) (ClientEnv mgr bayar4a)
      postSendEither `shouldSatisfy` isRight
      postSendEitherBad <- runClientM (postUsersSend userName userAddress postSendParametersBad) (ClientEnv mgr bayar4a)
      postSendEitherBad `shouldSatisfy` isLeft
  describe "postUsersContract" $
    it "should upload a contract" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        postUsersContractRequest = PostUsersContractRequest
          { src = simpleStorageSrc
          , password = pw
          }
      postUsersContractEither <- runClientM (postUsersContract userName userAddress postUsersContractRequest) (ClientEnv mgr bayar4a)
      postUsersContractEither `shouldSatisfy` isRight
  describe "postUsersUploadList" $
    it "should upload a list of contracts" $ \ TestConfig {..} -> do
      threadDelay delay
      let
        uploadListContracts =
          [ UploadListContract
            { uploadlistcontractContractName = simpleStorageContractName
            , uploadlistcontractArgs = HashMap.empty
            , uploadlistcontractTxParams = txParams
            }
          , UploadListContract
            { uploadlistcontractContractName = testContractName
            , uploadlistcontractArgs = HashMap.empty
            , uploadlistcontractTxParams = txParams
            }
          ]
        uploadListRequest = UploadListRequest
          { uploadlistPassword = pw
          , uploadlistContracts = uploadListContracts
          , uploadlistResolve = True
          }
      postUsersUploadEither <- runClientM (postUsersUploadList userName userAddress uploadListRequest) (ClientEnv mgr bayar4a)
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
          , postuserscontractmethodArgs = HashMap.empty
          , postuserscontractmethodValue = 0
          }
      postUsersContractMethodEither <- runClientM
        (postUsersContractMethod userName userAddress contractName contractAddress postUsersContractMethodRequest)
        (ClientEnv mgr bayar4a)
      postUsersContractMethodEither `shouldSatisfy` isRight
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
              , sendtransactionTxParams = Just $ txParams
              }
          }
      postSendListEither <- runClientM
        (postUsersSendList userName userAddress postSendListRequest)
        (ClientEnv mgr bayar4a)
      postSendListEither `shouldSatisfy` isRight
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
              , methodcallArgs = HashMap.empty
              , methodcallValue = 0
              , methodcallTxParams = txParams
              }
          }
      postCallMethodListEither <- runClientM
        (postUsersContractMethodList userName userAddress postMethodListRequest)
        (ClientEnv mgr bayar4a)
      postCallMethodListEither `shouldSatisfy` isRight
