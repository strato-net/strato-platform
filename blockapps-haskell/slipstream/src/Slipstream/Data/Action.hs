{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , DeriveGeneric
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , FlexibleInstances
#-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.Action where

import           BlockApps.Ethereum
import           BlockApps.SolidityVarReader (byteStringToWord256)
import qualified Data.ByteString.Base16      as B16
import qualified Data.ByteString.Char8       as C8
import           Data.Map.Strict             (Map)
import qualified Data.Map.Strict             as M
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import           Data.Time
import           Data.LargeWord              (Word256)
import           Data.Aeson
import           GHC.Generics

data ActionType = Create | Delete | Update deriving (Eq,Show, Generic)

data Action = Action
  { actionType            :: ActionType -- either Create, Delete, or Update
  , actionBlockHash       :: Keccak256
  , actionBlockTimestamp  :: UTCTime
  , actionBlockNumber     :: Integer
  , actionTxHash          :: Keccak256
  , actionTxChainId       :: Maybe ChainId
  , actionTxSender        :: Address
  , actionAddress         :: Address
  , actionCodeHash        :: Keccak256
  , actionStorage         :: Maybe (Map Word256 Word256)
  , actionMetadata        :: Maybe (Map Text Text)
  } deriving (Show, Generic)

instance FromJSON Action where
  parseJSON (Object o ) = Action
    <$> (o .: "actionType")
    <*> (o .: "actionBlockHash")
    <*> (o .: "actionBlockTimestamp")
    <*> (o .: "actionBlockNumber")
    <*> (o .: "actionTxHash")
    <*> (o .: "actionTxChainId")
    <*> (o .: "actionTxSender")
    <*> (o .: "actionAddress")
    <*> (o .: "actionCodeHash")
    <*> (fmap decodeStorage <$> (o .:? "actionStorage"))
    <*> (o .:? "actionMetadata")
  parseJSON o = error $ "parseJSON failed for Action: expected Object, got: " ++ show o

decodeStorage :: Map Text Text -> Map Word256 Word256
decodeStorage = M.mapKeys hexToWord256 . M.map hexToWord256
  where hexToWord256 = byteStringToWord256
                     . fst
                     . B16.decode
                     . C8.pack
                     . T.unpack

instance FromJSON ActionType
instance FromJSONKey (Hex Word256) where
    fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

formatAction :: Action -> Text
formatAction Action{..} = T.concat
  [ tshow actionType
  , ", blockHash: "
  , tshow actionBlockHash
  , ", blockTimestamp: "
  , tshow actionBlockTimestamp
  , ", blockNumber: "
  , tshow actionBlockNumber
  , ", transactionHash: "
  , tshow actionTxHash
  , ", "
  , (case actionTxChainId of
       Nothing -> ""
       Just c -> T.concat ["in chain", tshow c])
  , " with address: "
  , tshow actionAddress
  , " with "
  , tshow (maybe 0 M.size actionStorage)
  , " items\n"
  , "    codeHash = "
  , tshow actionCodeHash
  , "\n"
  , "    storage   = "
  , tshow $ fmap M.size actionStorage
  , "\n"
  , "    metadata  = "
  , tshow actionMetadata
  ]
  where tshow :: Show a => a -> Text
        tshow = T.pack . show
