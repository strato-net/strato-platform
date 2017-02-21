{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Bloc.API.Utils where

import Control.Concurrent
import Control.Monad.Loops
import Control.Monad.IO.Class
import Data.Aeson
import Data.Aeson.Casing
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Char8 as Char8
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Foldable
import Data.Functor.Contravariant
import Data.Map.Strict (Map)
import Data.Maybe
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Servant.API
import Servant.Client
import Servant.Docs
import qualified Network.HTTP.Media as M
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Numeric.Natural

import BlockApps.Data
import BlockApps.Strato.API.Client
import BlockApps.Strato.Types
import Network.HTTP.Client

-- hack because endpoints are returning stringified json as text/html
data HTMLifiedJSON
instance Accept HTMLifiedJSON where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance FromJSON x => MimeUnrender HTMLifiedJSON x where
  mimeUnrender _ = eitherDecode
instance ToJSON x => MimeRender HTMLifiedJSON x where
  mimeRender _ = encode

data HTMLifiedAddress
instance Accept HTMLifiedAddress where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance MimeUnrender HTMLifiedAddress Address where
  mimeUnrender _
    = maybe (Left "could not unrender Address") Right
    . stringAddress . Lazy.Char8.unpack
instance MimeRender HTMLifiedAddress Address where
  mimeRender _ = Lazy.Char8.pack . addressString

newtype ContractName = ContractName Text
instance ToHttpApiData ContractName where
  toUrlPiece (ContractName name) = name
instance FromHttpApiData ContractName where
  parseUrlPiece = Right . ContractName
instance ToJSON ContractName where
  toJSON (ContractName name) = toJSON name
instance FromJSON ContractName where
  parseJSON = fmap ContractName . parseJSON
instance ToCapture (Capture "contractName" ContractName) where
  toCapture _ = DocCapture "contractName" "a contract name"

-- hack because endpoints are returning stringified json
-- as application/octet-stream
instance FromJSON x => MimeUnrender OctetStream x where
  mimeUnrender _ = eitherDecode
instance ToJSON x => MimeRender OctetStream x where
  mimeRender _ = encode

addressDecoder :: Decoders.Value Address
addressDecoder
  = fromMaybe (error "cannot decode address")
  . stringAddress
  . Char8.unpack <$> Decoders.bytea

addressEncoder :: Encoders.Value Address
addressEncoder = contramap (Char8.pack . addressString) Encoders.bytea

tester7 :: BaseUrl
tester7 = BaseUrl Http "tester7.centralus.cloudapp.azure.com" 80 "/bloc"

bayar4a :: BaseUrl
bayar4a = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/bloc"

strato :: BaseUrl
strato = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/strato-api/eth/v1.2"

-- data SolidityValue
--   = SolidityValueString Text

data SolidityValue
  = SolidityValueAsString Text
  | SolidityBool Bool
  | SolidityArray [SolidityValue]
  | SolidityBytes  ByteString
  deriving (Eq,Show,Generic)
instance ToJSON SolidityValue where
  toJSON (SolidityValueAsString str) = toJSON str
  toJSON (SolidityBool boolean) = toJSON boolean
  toJSON (SolidityArray array) = toJSON array
  toJSON (SolidityBytes bytes) = object
    [ "type" .= ("Buffer" :: Text)
    , "data" .= ByteString.unpack bytes
    ]
instance FromJSON SolidityValue where
  parseJSON (String str) = return $ SolidityValueAsString str
  parseJSON (Bool boolean) = return $ SolidityBool boolean
  parseJSON (Array array) = SolidityArray <$> traverse parseJSON (toList array)
  parseJSON (Object obj) = do
    ty <- obj .: "type"
    if ty == ("Buffer" :: Text)
    then do
      bytes <- obj .: "data"
      return $ SolidityBytes (ByteString.pack bytes)
    else
      fail "Failed to parse SolidityBytes"
  parseJSON _ = fail "Failed to parse solidity value"
instance Arbitrary SolidityValue where
  arbitrary = return (SolidityBool True)

data ContractDetails = ContractDetails
  { contractdetailsBin :: Text
  , contractdetailsAddress :: Maybe Address
  , contractdetailsBinRuntime :: Text
  , contractdetailsCodeHash :: Text
  , contractdetailsName :: Text
  , contractdetailsXabi :: Xabi
  } deriving (Show,Eq,Generic)
instance ToJSON ContractDetails where
  toJSON ContractDetails{..} = object
    [ "bin" .= contractdetailsBin
    , "address" .= contractdetailsAddress
    , "bin-runtime" .= contractdetailsBinRuntime
    , "codeHash" .= contractdetailsCodeHash
    , "name" .= contractdetailsName
    , "xabi" .= contractdetailsXabi
    ]
instance FromJSON ContractDetails where
  parseJSON = withObject "ContractDetails" $ \obj ->
    ContractDetails
      <$> obj .: "bin"
      <*> obj .:? "address"
      <*> obj .: "bin-runtime"
      <*> obj .: "codeHash"
      <*> obj .: "name"
      <*> obj .: "xabi"
instance ToSample ContractDetails where toSamples _ = noSamples
instance Arbitrary ContractDetails where
  arbitrary = genericArbitrary
data Xabi = Xabi
  { xabiFuncs :: Maybe (Map Text Func)
  , xabiConstr :: Maybe (Map Text Arg)
  , xabiVars :: Maybe (Map Text Var)
  } deriving (Eq,Show,Generic)
instance ToJSON Xabi where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Xabi where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Xabi where arbitrary = genericArbitrary
data Func = Func
  { funcArgs :: Map Text Arg
  , funcSelector :: Text
  , funcVals :: Map Text Val
  } deriving (Eq,Show,Generic)
instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Func where arbitrary = genericArbitrary
data Arg = Arg
  { argName :: Maybe Text
  , argType :: Text
  , argBytes :: Maybe Int
  , argIndex :: Int
  , argDynamic :: Maybe Bool
  , argEntry :: Maybe Entry
  , argTypedef :: Maybe Text
  } deriving (Eq,Show,Generic)
instance ToJSON Arg where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Arg where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Arg where arbitrary = genericArbitrary
data Entry = Entry
  { entryBytes :: Int
  , entryType :: Text
  } deriving (Eq,Show,Generic)
instance ToJSON Entry where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Entry where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Entry where arbitrary = genericArbitrary
data Val = Val
  { valType :: Text
  , valBytes :: Maybe Int
  , valIndex :: Int
  , valDynamic :: Maybe Bool
  , valEntry :: Maybe Entry
  , valTypedef :: Maybe Text
  } deriving (Eq,Show,Generic)
instance ToJSON Val where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Val where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Val where arbitrary = genericArbitrary
data Var = Var
  { varType :: Text
  , varBytes :: Maybe Int
  , varAtBytes :: Int
  , varDynamic :: Maybe Bool
  , varEntry :: Maybe Entry
  , varTypedef :: Maybe Text
  } deriving (Eq,Show,Generic)
instance ToJSON Var where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Var where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Var where arbitrary = genericArbitrary


waitNewBlock :: ClientM ()
waitNewBlock = do
  blockNum <- lastBlockNum
  liftIO $ print blockNum
  untilM_
    (liftIO (putStrLn "checking condition" >> (threadDelay 1000000)))
    (do
      liftIO $ putStrLn "getting last block number"
      blockNum' <- lastBlockNum
      liftIO $ print blockNum'
      return $ blockNum' /= blockNum)
  where
    lastBlockNum
      = blockdataNumber
      . blockBlockData
      . withoutNext
      . head <$> getBlocksLast 0

newtype UserName = UserName Text deriving (Eq,Show,Generic)
instance ToHttpApiData UserName where
  toUrlPiece (UserName name) = name
instance FromHttpApiData UserName where
  parseUrlPiece = Right . UserName
instance ToJSON UserName where
  toJSON (UserName name) = toJSON name
instance FromJSON UserName where
  parseJSON = fmap UserName . parseJSON
instance ToSample UserName where
  toSamples _ = samples
    [ UserName name | name <- ["samrit", "eitan", "ilya", "ilir"]]
instance ToCapture (Capture "user" UserName) where
  toCapture _ = DocCapture "user" "a user name"
instance Arbitrary UserName where arbitrary = genericArbitrary

data TxParams = TxParams
  { txparamsGasLimit :: Natural
  , txparamsGasPrice :: Natural
  } deriving (Eq,Show,Generic)
instance Arbitrary TxParams where arbitrary = genericArbitrary
instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

data TestConfig = TestConfig
  { mgr :: Manager
  , userName :: UserName
  , userAddress :: Address
  , toUserName :: UserName
  , toUserAddress :: Address
  , pw :: Text
  , simpleStorageContractName :: Text
  , simpleStorageContractAddress :: Address
  , testContractName :: Text
  , testContractAddress :: Address
  , simpleMappingContractName :: Text
  , simpleMappingContractAddress :: Address
  , txParams :: TxParams
  , simpleStorageSrc :: Text
  , testSrc :: Text
  , simpleMappingSrc :: Text
  , delay :: Int --microsecond
  } deriving (Generic)
