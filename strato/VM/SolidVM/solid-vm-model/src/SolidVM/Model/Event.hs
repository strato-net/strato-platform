{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingVia #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module SolidVM.Model.Event
  ( Event (..),
    eventArgValueString,
    eventArgValue,
    eventArgName,
  )
where

import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.Applicative ((<|>))
import Control.DeepSeq
import Data.Aeson hiding (Value)
import qualified Data.Aeson as Aeson
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Store (Store)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import GHC.Generics
import SolidVM.Model.Storable (StoreList (..))
import SolidVM.Model.Value (Value (..), renderValue)
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Format

-- A SolidVM event emitted from a contract.
--
-- Each entry in 'evArgs' is @(argName, argValue)@:
--   * argName: parameter name from the event declaration
--   * argValue: fully evaluated Value captured at emit time (only 'Constant'
--     cells, no storage references; an arg that was never written is the
--     declared type's default value); render with 'renderValue' where text
--     is needed
--
-- 'evTopics' holds the Ethereum log topics (topic0 = event signature hash,
-- followed by each indexed argument, each 32 bytes) computed at emit time from
-- the contract ABI. Carried here so the block producer can build a real
-- logsBloom without re-deriving topics from the CodeCollection.
data Event = Event
  { evTxHash :: Keccak256,
    evTxSender :: Address,
    evContractName :: T.Text,
    evContractAddress :: Address,
    evName :: T.Text,
    evArgs :: [(T.Text, Value)],
    evTopics :: [B.ByteString]
  }
  deriving (Eq, Show, Generic)

eventArgName :: (T.Text, Value) -> T.Text
eventArgName = fst

eventArgValue :: (T.Text, Value) -> Value
eventArgValue = snd

eventArgValueString :: (T.Text, Value) -> T.Text
eventArgValueString = renderValue . eventArgValue

instance Format Event where
  format Event {..} =
    "evTxHash: "
      ++ format evTxHash
      ++ "\n"
      ++ "evTxSender: "
      ++ format evTxSender
      ++ "evContractName: "
      ++ T.unpack evContractName
      ++ "\n"
      ++ "evContractAccount: "
      ++ format evContractAddress
      ++ "\n"
      ++ "evName: "
      ++ T.unpack evName
      ++ "\n"
      ++ "evArgs: "
      ++ show [(n, renderValue v) | (n, v) <- evArgs]
      ++ "\n"

instance Binary Event

deriving via (StoreList (T.Text, Value)) instance {-# OVERLAPPING #-} Store [(T.Text, Value)]

instance Store Event

instance ToJSON Event where
  toJSON Event {..} =
    object
      [ "eventTxHash" .= evTxHash,
        "eventTxSender" .= evTxSender,
        "eventContractName" .= evContractName,
        "eventContractAddress" .= evContractAddress,
        "eventName" .= evName,
        -- JSON arg form is [name, value, rendered]
        "eventArgs" .= [(n, v, renderValue v) | (n, v) <- evArgs],
        "eventTopics" .= map (TE.decodeUtf8 . B16.encode) evTopics
      ]

instance FromJSON Event where
  parseJSON (Object o) =
    Event
      <$> o .: "eventTxHash"
      <*> o .: "eventTxSender"
      <*> o .: "eventContractName"
      <*> o .: "eventContractAddress"
      <*> o .: "eventName"
      <*> (o .: "eventArgs" >>= mapM parseEventArg)
      -- Default to no topics for events written by older nodes (e.g. an
      -- existing genesis.json), keeping deserialization backward compatible.
      <*> (map decodeHexTopic <$> (o .:? "eventTopics" .!= []))
    where
      decodeHexTopic :: T.Text -> B.ByteString
      decodeHexTopic = either (const B.empty) id . B16.decode . TE.encodeUtf8
      -- Accept the current form [name, value, rendered] plus the two older
      -- forms written by earlier nodes (e.g. events in an existing genesis.json):
      -- [name, value, rendered, type] and [name, rendered, typeString]. The
      -- oldest form carries no typed Value, so its text is kept as an SString;
      -- typed consumers fall back on that (see SolidVM.Model.Delta). It must be
      -- tried first: 'FromJSON Value' accepts any non-object as SNULL.
      parseEventArg v = parseTextArg v <|> parseTypedArg v <|> parseCurrentArg v
      parseTextArg v = do
        (n, s, _ :: T.Text) <- parseJSON v
        pure (n, SString (T.unpack s))
      parseTypedArg v = do
        (n, val, _ :: T.Text, _ :: Aeson.Value) <- parseJSON v
        pure (n, val)
      parseCurrentArg v = do
        (n, val, _ :: T.Text) <- parseJSON v
        pure (n, val)
  parseJSON o = error $ "parseJSON Event: Expected object, got:" ++ show o

instance NFData Event

instance Arbitrary Event where
  arbitrary = do
    th <- arbitrary
    sender <- arbitrary
    cn <- arbitrary
    ca <- arbitrary
    nm <- arbitrary
    args <- listOf $ do
      n <- arbitrary
      pure (n, SInteger 0)
    pure $ Event th sender cn ca nm args []
