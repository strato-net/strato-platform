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
import Control.Monad.Log
import Control.Monad.Loops
import Control.Monad.IO.Class
import Data.Aeson
import Data.Aeson.Casing
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Maybe
import Data.Monoid
import Data.String
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

import BlockApps.Bloc.Monad
import BlockApps.Ethereum
import BlockApps.Strato.Client
import BlockApps.Strato.Types

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
instance IsString ContractName where
  fromString = ContractName . Text.pack
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

waitNewAccount :: Address -> ClientM Account
waitNewAccount addr = untilJust $ listToMaybe <$>
  getAccountsFilter accountsFilterParams{qaAddress = Just addr}

pollTxResult :: Text -> Bloc TransactionResult
pollTxResult hash = untilJust $ do
  liftIO $ threadDelay 1000000
  logWith logNotice $ "Looking up " <> hash
  result <- blocStrato $ getTxResult hash
  return $ listToMaybe result

newtype UserName = UserName {getUserName :: Text} deriving (Eq,Show,Generic)
instance IsString UserName where
  fromString = UserName . Text.pack
instance ToHttpApiData UserName where
  toUrlPiece = getUserName
instance FromHttpApiData UserName where
  parseUrlPiece = Right . UserName
instance ToJSON UserName where
  toJSON = toJSON . getUserName
instance FromJSON UserName where
  parseJSON = fmap UserName . parseJSON
instance ToSample UserName where
  toSamples _ = samples
    [ UserName name | name <- ["samrit", "eitan", "ilya", "ilir"]]
instance ToCapture (Capture "user" UserName) where
  toCapture _ = DocCapture "user" "a user name"
instance Arbitrary UserName where arbitrary = genericArbitrary uniform

data TxParams = TxParams
  { txparamsGasLimit :: Maybe Gas
  , txparamsGasPrice :: Maybe Wei
  , txparamsNonce :: Maybe Nonce
  } deriving (Eq,Show,Generic)
instance Arbitrary TxParams where arbitrary = genericArbitrary uniform
instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
emptyTxParams :: TxParams
emptyTxParams = TxParams Nothing Nothing Nothing
