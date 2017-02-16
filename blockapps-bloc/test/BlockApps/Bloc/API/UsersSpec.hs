{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Bloc.API.UsersSpec where


import qualified Data.HashMap.Strict as HashMap
import Data.Either
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Users
import BlockApps.Bloc.API.Utils
import BlockApps.Data

-- TODO: user/contract methods Addresses may need to be MayBe Named Address

spec :: Spec
spec
  = beforeAll (newManager defaultManagerSettings) $ do
    describe "getUsers" $
      it "should get a list of users" $ \ mgr -> do
        usersEither <- runClientM getUsers (ClientEnv mgr tester7)
        usersEither `shouldSatisfy` isRight
    describe "getUsersUser" $
      it "should get a list of user's addresses" $ \ mgr -> do
        let
          username = UserName "admin"
        userAddressesEither <- runClientM (getUsersUser username) (ClientEnv mgr tester7)
        userAddressesEither `shouldSatisfy` isRight
    describe "postUsersUser" $
      it "should create and faucet a user address" $ \ mgr -> do
        let
          username = UserName "blockapps"
          postUsersUserRequest = PostUsersUserRequest 1 "1234"
        postUsersEither <- runClientM (postUsersUser username postUsersUserRequest) (ClientEnv mgr tester7)
        postUsersEither `shouldSatisfy` isRight
    describe "postUsersSend" $
      it "should send ethers to another address" $ \ mgr -> do
        let
          username = UserName "blockapps"
          address = Address 0x1d00ecbe4a4f1c12967b0ad31e396335653f8f78
          postSendParameters = PostSendParameters (Address 0xddb9fa06155e06d3fcf274b8e0a6680d0dc95370) 100 "1234"
          postSendParametersBad = PostSendParameters (Address 0xddb9fa06155e06d3fcf274b8e0a6680d0dc95370) 100 "12345"
        postSendEither <- runClientM (postUsersSend username address postSendParameters) (ClientEnv mgr tester7)
        postSendEither `shouldSatisfy` isRight
        postSendEitherBad <- runClientM (postUsersSend username address postSendParametersBad) (ClientEnv mgr tester7)
        postSendEitherBad `shouldSatisfy` isLeft
    describe "postUsersContract" $
      it "should upload a contract" $ \ mgr -> do
        let
          username = UserName "blockapps"
          address = Address 0x1d00ecbe4a4f1c12967b0ad31e396335653f8f78
          postUsersContractRequest = PostUsersContractRequest
            { src = "contract SimpleStorage { uint storedData; function set(uint x) \
              \{ storedData = x; } function get() returns (uint retVal) \
              \{ return storedData; } }"
            , password = "1234"
            }
        postUsersContractEither <- runClientM (postUsersContract username address postUsersContractRequest) (ClientEnv mgr tester7)
        postUsersContractEither `shouldSatisfy` isRight
    describe "postUsersUploadList" $
      it "should upload a list of contracts" $ \ mgr -> do
        let
          username = UserName "blockapps"
          address = Address 0x1d00ecbe4a4f1c12967b0ad31e396335653f8f78
          uploadListContracts =
            [ UploadListContract
              { uploadlistcontractContractName = "SimpleStorage"
              , uploadlistcontractArgs = HashMap.empty
              , uploadlistcontractTxParams = TxParams 100000000 1
              }
            , UploadListContract
              { uploadlistcontractContractName = "Test"
              , uploadlistcontractArgs = HashMap.empty
              , uploadlistcontractTxParams = TxParams 100000000 1
              }
            ]
          uploadListRequest = UploadListRequest
            { uploadlistPassword = "1234"
            , uploadlistContracts = uploadListContracts
            , uploadlistResolve = True
            }
        postUsersUploadEither <- runClientM
          (postUsersUploadList username address uploadListRequest)
          (ClientEnv mgr tester7)
        postUsersUploadEither `shouldSatisfy` isRight
    describe "postUsersContractMethod" $
      it "should call a contract method" $ \ mgr -> do
        let
          username = UserName "blockapps"
          userAddress = Address 0x1d00ecbe4a4f1c12967b0ad31e396335653f8f78
          contractName = ContractName "SimpleStorage"
          contractAddress = Address 0xd83ee2385c97cae03a17ace7d17fe41963177ae5
          postUsersContractMethodRequest = PostUsersContractMethodRequest
            { postuserscontractmethodPassword = "1234"
            , postuserscontractmethodMethod = "get"
            , postuserscontractmethodArgs = HashMap.empty
            , postuserscontractmethodValue = 0
            }
        postUsersContractMethodEither <- runClientM
          (postUsersContractMethod username userAddress contractName contractAddress postUsersContractMethodRequest)
          (ClientEnv mgr tester7)
        postUsersContractMethodEither `shouldSatisfy` isRight
    describe "postUsersSendList" $
      it "should post a list of send transactions" $ \ mgr -> do
        let
          username = UserName "blockapps"
          userAddress = Address 0x1d00ecbe4a4f1c12967b0ad31e396335653f8f78
          postSendListRequest = PostSendListRequest
            { postsendlistrequestPassword  = "1234"
            , postsendlistrequestResolve = True
            , postsendlistrequestTxs = replicate 3
                SendTransaction
                { sendtransactionToAddress = Address 0xddb9fa06155e06d3fcf274b8e0a6680d0dc95370
                , sendtransactionValue = 100
                , sendtransactionTxParams = Just $ TxParams 100000000 1
                }
            }
        postSendListEither <- runClientM
          (postUsersSendList username userAddress postSendListRequest)
          (ClientEnv mgr tester7)
        postSendListEither `shouldSatisfy` isRight
    describe "postUsersContractMethodList" $
      it "should call a list of methods" $ \ mgr -> do
        let
          username = UserName "blockapps"
          userAddress = Address 0x1d00ecbe4a4f1c12967b0ad31e396335653f8f78
          postMethodListRequest = PostMethodListRequest
            { postmethodlistrequestPassword = "1234"
            , postmethodlistrequestResolve = True
            , postmethodlistrequestTxs = replicate 3
                MethodCall
                { methodcallContractName = "SimpleStorage"
                , methodcallContractAddress = Address 0xd83ee2385c97cae03a17ace7d17fe41963177ae5
                , methodcallMethodName = "get"
                , methodcallArgs = HashMap.empty
                , methodcallValue = 0
                , methodcallTxParams = TxParams 100000000 1
                }
            }
        postCallMethodListEither <- runClientM
          (postUsersContractMethodList username userAddress postMethodListRequest)
          (ClientEnv mgr tester7)
        postCallMethodListEither `shouldSatisfy` isRight
