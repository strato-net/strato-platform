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

import Control.Applicative
import Control.Concurrent
import Control.Monad.Loops
import Control.Monad.IO.Class
import Data.Aeson
import Data.Aeson.Casing
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Int (Int32)
import Data.Map.Strict (Map)
import Data.Text (Text)
import qualified Data.Text as Text
import Generic.Random.Generic
import GHC.Generics
import Servant.API
import Servant.Client
import Servant.Docs
import qualified Network.HTTP.Media as M
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Numeric.Natural

import BlockApps.Ethereum
import BlockApps.Strato.Client
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

tester7 :: BaseUrl
tester7 = BaseUrl Http "tester7.centralus.cloudapp.azure.com" 80 "/bloc"

bayar4a :: BaseUrl
bayar4a = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/bloc"

strato :: BaseUrl
strato = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/strato-api/eth/v1.2"

data ContractDetails = ContractDetails
  { contractdetailsBin :: Text
  , contractdetailsAddress :: Maybe (MaybeNamed Address)
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
  arbitrary = genericArbitrary uniform
data Xabi = Xabi
  { xabiFuncs :: Maybe (Map Text Func)
  , xabiConstr :: Maybe (Map Text Arg)
  , xabiVars :: Maybe (Map Text Var)
  } deriving (Eq,Show,Generic)
instance ToJSON Xabi where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Xabi where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Xabi where arbitrary = genericArbitrary uniform
data Func = Func
  { funcArgs :: Map Text Arg
  , funcSelector :: Text
  , funcVals :: Map Text Val
  } deriving (Eq,Show,Generic)
instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Func where arbitrary = genericArbitrary uniform
data Arg = Arg
  { argName :: Maybe Text
  , argIndex :: Int32
  , argType :: Maybe Text
  , argTypedef :: Maybe Text
  , argDynamic :: Maybe Bool
  , argBytes :: Maybe Int32
  , argEntry :: Maybe Entry
  } deriving (Eq,Show,Generic)
instance ToJSON Arg where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Arg where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Arg where arbitrary = genericArbitrary uniform
data Entry = Entry
  { entryBytes :: Int32
  , entryType :: Text
  } deriving (Eq,Show,Generic)
instance ToJSON Entry where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Entry where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Entry where arbitrary = genericArbitrary uniform
data Val = Val
  { valIndex :: Int32
  , valType :: Maybe Text
  , valTypedef :: Maybe Text
  , valDynamic :: Maybe Bool
  , valBytes :: Maybe Int32
  , valEntry :: Maybe Entry
  } deriving (Eq,Show,Generic)
instance ToJSON Val where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Val where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Val where arbitrary = genericArbitrary uniform
data Var = Var
  { varAtBytes :: Int32
  , varType :: Maybe Text
  , varTypedef :: Maybe Text
  , varDynamic :: Maybe Bool
  , varSigned :: Maybe Bool
  , varBytes :: Maybe Int32
  , varEntry :: Maybe Entry
  , varVal :: Maybe SimpleVar
  , varKey :: Maybe SimpleVar
  } deriving (Eq,Show,Generic)
instance ToJSON Var where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Var where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Var where arbitrary = genericArbitrary uniform
data SimpleVar = SimpleVar
  { simplevarType :: Text
  , simplevarBytes :: Maybe Int32
  -- , simplevarTypedef :: Maybe Text -- TODO: Do we need this?
  , simplevarDynamic :: Maybe Bool
  , simplevarSigned :: Maybe Bool
  , simplevarEntry :: Maybe Entry
  } deriving (Eq,Show,Generic)
instance ToJSON SimpleVar where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON SimpleVar where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary SimpleVar where arbitrary = genericArbitrary uniform

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
instance Arbitrary UserName where arbitrary = genericArbitrary uniform

data TxParams = TxParams
  { txparamsGasLimit :: Natural
  , txparamsGasPrice :: Natural
  } deriving (Eq,Show,Generic)
instance Arbitrary TxParams where arbitrary = genericArbitrary uniform
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

data MaybeNamed a = Named Text | Unnamed a deriving (Eq,Show,Generic)
instance ToJSON a => ToJSON (MaybeNamed a) where
  toJSON (Named name) = toJSON name
  toJSON (Unnamed a) = toJSON a
instance FromJSON a => FromJSON (MaybeNamed a) where
  parseJSON x = Unnamed <$> parseJSON x <|> Named <$> parseJSON x
instance Arbitrary a => Arbitrary (MaybeNamed a) where
  arbitrary = oneof
    [ elements [Named "name1", Named "name2", Named "name3"]
    , Unnamed <$> arbitrary
    ]
instance ToHttpApiData (MaybeNamed Address) where
  toUrlPiece (Named name) = name
  toUrlPiece (Unnamed addr) = Text.pack . addressString $ addr
instance FromHttpApiData (MaybeNamed Address) where
  parseUrlPiece txt = case stringAddress (Text.unpack txt) of
    Nothing -> Right $ Named txt
    Just addr -> Right $ Unnamed addr
instance ToSample (MaybeNamed Address) where
  toSamples _ = [("Sample", Unnamed (Address 0xdeadbeef))]
instance ToCapture (Capture "contractAddress" (MaybeNamed Address)) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address or Contract Name"
