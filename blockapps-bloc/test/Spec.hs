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

import BlockApps.Data

main :: IO ()
main = hspec $ do
  API.spec
  beforeAll setup $ do
    Addresses.spec
    Contracts.spec
    Search.spec
    Users.spec

setup :: IO TestConfig
setup = do
  mgr' <- newManager defaultManagerSettings
  let
    testConfig = TestConfig
      { mgr = mgr'
      , userName = UserName "testUser1"
      , userAddress = Address 0x0
      , toUserName = UserName "testUser2"
      , toUserAddress = Address 0x0
      , pw = "1234"
      , simpleStorageContractName = "SimpleStorage"
      , simpleStorageContractAddress = Address 0x0
      , testContractName = "Test"
      , testContractAddress  = Address 0x0
      , simpleMappingContractName = "SimpleMapping"
      , simpleMappingContractAddress = Address 0x0
      , txParams = TxParams 10000000000 1
      , simpleStorageSrc =
          "contract SimpleStorage {\
          \    uint storedData;\
          \    function set(uint x) {\
          \        storedData = x;\
          \    }\
          \    function get() returns (uint retVal) {\
          \        return storedData;\
          \    }\
          \}"
      , testSrc =
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
      , simpleMappingSrc =
          "contract SimpleMapping {\
          \  mapping (uint => byte[]) m;\
          \  mapping (uint => bool) m2;\
          \  function SimpleMapping() {\
          \    byte [] memory b = new byte[](10);\
          \    for(uint i = 0; i < 10; i++) {\
          \      b[i] = 0x01;\
          \    }\
          \    m[1] = b;\
          \    m2[1] = true;\
          \  }\
          \}"
      , delay =
          let second = 1000000
          in 6 * second
      }

    postCompileRequest1 = PostCompileRequest [] (simpleStorageContractName testConfig) (simpleStorageSrc testConfig)
    postCompileRequest2 = PostCompileRequest [] (testContractName testConfig) (testSrc testConfig)
    postCompileRequest3 = PostCompileRequest [] (simpleMappingContractName testConfig) (simpleMappingSrc testConfig)
    -- postUsersContractRequest1 = PostUsersContractRequest simpleStorage pw
    uploadListContract1 = UploadListContract
      { uploadlistcontractContractName = simpleStorageContractName testConfig
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = txParams testConfig
      }
    uploadListContract2 = UploadListContract
      { uploadlistcontractContractName = testContractName testConfig
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = txParams testConfig
      }
    uploadListContract3 = UploadListContract
      { uploadlistcontractContractName = simpleMappingContractName testConfig
      , uploadlistcontractArgs = HashMap.empty
      , uploadlistcontractTxParams = txParams testConfig
      }
    uploadListRequest = UploadListRequest
      { uploadlistPassword = pw testConfig
      , uploadlistContracts = [uploadListContract1,uploadListContract2,uploadListContract3]
      , uploadlistResolve = True
      }
    clients = do
      addr1 <- postUsersUser (userName testConfig) (PostUsersUserRequest 1 (pw testConfig))
      addr2 <- postUsersUser (toUserName testConfig) (PostUsersUserRequest 1 (pw testConfig))
      void $ postContractsCompile [postCompileRequest1,postCompileRequest2,postCompileRequest3]
      PostUsersUploadListResponse simpleStorageDetails
        : PostUsersUploadListResponse testDetails
        : PostUsersUploadListResponse simpleMappingDetails
        : _ <- postUsersUploadList (userName testConfig) addr1 uploadListRequest
      let
        Just (Unnamed sscAddr) = contractdetailsAddress simpleStorageDetails
        Just (Unnamed tcAddr) = contractdetailsAddress testDetails
        Just (Unnamed smcAddr) = contractdetailsAddress simpleMappingDetails
        config = testConfig
          { userAddress = addr1
          , toUserAddress = addr2
          , simpleStorageContractAddress = sscAddr
          , testContractAddress = tcAddr
          , simpleMappingContractAddress = smcAddr
          }
      return config
  cfgEither <- runClientM clients (ClientEnv mgr' bayar4a)
  case cfgEither of
    Left err -> fail $ "Failed to bootstrap tests: " ++ show err
    Right cfg -> return cfg
