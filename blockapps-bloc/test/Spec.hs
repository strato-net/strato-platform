{-# LANGUAGE
    OverloadedStrings
#-}

module Main where

import Control.Monad
import qualified Data.HashMap.Strict as HashMap
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import qualified BlockApps.Bloc.API.AddressesSpec as Addresses
import BlockApps.Bloc.API.Contracts
import qualified BlockApps.Bloc.API.ContractsSpec as Contracts
import qualified BlockApps.Bloc.API.SearchSpec as Search
import BlockApps.Bloc.API.Users
import qualified BlockApps.Bloc.API.UsersSpec as Users
import BlockApps.Bloc.API.Utils
import qualified BlockApps.Bloc.APISpec as API

main :: IO ()
main = hspec $ do
  API.spec
  beforeAll setup $ do
    Addresses.spec
    Contracts.spec
    Search.spec
    Users.spec

setup :: IO Manager
setup = do
  mgr <- newManager defaultManagerSettings
  let
    testUser = UserName "testUser"
    pw = "1234"
    simpleStorage =
      "contract SimpleStorage {\
      \    uint storedData;\
      \    function set(uint x) {\
      \        storedData = x;\
      \    }\
      \    function get() returns (uint retVal) {\
      \        return storedData;\
      \    }\
      \}"
    testContract =
      "contract EmbeddedContract {\
        \uint public x;\
        \function EmbeddedContract(uint _uint) {\
          \x = _uint;\
        \}\
      \}\
      \contract Test {\
        \address tAddress;\
        \uint tUint;\
        \int tInt;\
        \bool tBool;\
        \int256 tInt256;\
        \uint [] tUintArray;\
        \string tString;\
        \byte [] tByteArray;\
        \byte tByte;\
        \bytes32 tBytes32;\
        \mapping(address => uint) tMapping;\
        \mapping(string => byte[]) tMapping2;\
        \mapping(int => string) tMapping3;\
        \EmbeddedContract tEc;\
        \function Test()\
        \{\
          \tAddress = 0x123;\
          \tUint = 20;\
          \tInt = 40;\
          \tBool = true;\
          \tInt256 = 2173456789;\
          \tUintArray = new uint[](10);\
          \for(uint i = 0; i < 10; i++) {\
            \tUintArray[i] = i;\
          \}\
          \tString = \"Hello World\";\
          \tByteArray = new byte[](10);\
          \for(uint j= 0; j < 10; j++) {\
            \tByteArray[j] = 0x01;\
          \}\
          \tByte = 0x02;\
          \tBytes32 = \"test\";\
          \tMapping[tAddress] = 20;\
          \tMapping2[\"first\"] = tByteArray;\
          \tMapping3[0] = \"hello\";\
          \tMapping3[1] = \"world\";\
        \}\
        \function getAddress () returns (address)\
        \{\
          \return tAddress;\
        \}\
        \function getUInt () returns (uint)\
        \{\
          \return tUint;\
        \}\
        \function getTInt () returns (int)\
        \{\
          \return tInt;\
        \}\
        \function getBool () returns (bool)\
        \{\
          \return tBool;\
        \}\
        \function getInt256 () returns (int256)\
        \{\
          \return tInt256;\
        \}\
        \function getUIntArray () returns (uint [])\
        \{\
          \return tUintArray;\
        \}\
        \function getString() returns (string)\
        \{\
          \return tString;\
        \}\
        \function getByteArrat() returns (byte [])\
        \{\
          \return tByteArray;\
        \}\
        \function getBytes32() returns (bytes32)\
        \{\
          \return tBytes32;\
        \}\
        \function getByte() returns (byte)\
        \{\
          \return tByte;\
        \}\
        \function getMultipleValues() returns (string s, uint i)\
        \{\
          \s = tString;\
          \i = tUint;\
        \}\
        \function testFunction (address _address, string _string) returns (byte[])\
        \{\
        \}\
        \function testFunction3(string _string, bytes32 _bytes32, byte[] _byteArray) returns (string stringValue, uint uintValue)\
        \{\
        \}\
        \function test4 () returns (EmbeddedContract)\
        \{\
        \}\
        \function test5 (EmbeddedContract ec) {\
        \}\
      \}"
    postCompileRequest1 = PostCompileRequest [] "SimpleStorage" simpleStorage
    postCompileRequest2 = PostCompileRequest [] "Test" testContract
    -- postUsersContractRequest1 = PostUsersContractRequest simpleStorage pw
    uploadListContract1 = UploadListContract
      { uploadlistcontractContractName = "SimpleStorage"
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = TxParams 10000000000 1
      }
    uploadListContract2 = UploadListContract
      { uploadlistcontractContractName = "Test"
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = TxParams 10000000000 1
      }
    uploadListRequest = UploadListRequest
      { uploadlistPassword = pw
      , uploadlistContracts = [uploadListContract1,uploadListContract2]
      , uploadlistResolve = True
      }
    clients = do
      addr <- postUsersUser testUser (PostUsersUserRequest 1 "1234")
      void $ postContractsCompile [postCompileRequest1,postCompileRequest2]
      void $ postUsersUploadList testUser addr uploadListRequest
  void $ runClientM clients (ClientEnv mgr bayar4a)
  return mgr
