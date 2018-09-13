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

import            BlockApps.Ethereum
import            Data.Map.Strict         (Map)
import qualified  Data.Map.Strict         as M
import            Data.Text               (Text)
import qualified  Data.Text               as T
import            Data.Time
import            Data.LargeWord          (Word256)
import            Data.Aeson
import            GHC.Generics

data ActionType = Create | Delete | Update deriving (Eq,Show, Generic)

data SourcePtr = SourcePtr { sourceHash :: Keccak256, contractName :: Text} deriving (Eq, Show, Generic)

data Action = Action
  { actionType         :: ActionType -- either Create, Delete, or Update
  , blockHash          :: Keccak256
  , blockTimestamp     :: UTCTime
  , blockNumber        :: Integer
  , transactionHash    :: Keccak256
  , transactionChainId :: Maybe ChainId
  , transactionSender  :: Address
  , address            :: Address
  , codeHash           :: Keccak256
  , sourcePtr          :: Maybe SourcePtr
  , storage            :: Maybe (Map (Hex Word256) (Hex Word256))
  } deriving (Show, Generic)

instance FromJSON Action
instance FromJSON ActionType
instance FromJSON SourcePtr
instance FromJSONKey Action
instance FromJSONKey (Hex Word256)

formatAction :: Action -> Text
formatAction Action{..} = T.concat
  [ tshow actionType
  , ", blockHash: "
  , tshow blockHash
  , ", blockTimestamp: "
  , tshow blockTimestamp
  , ", blockNumber: "
  , tshow blockNumber
  , ", transactionHash: "
  , tshow transactionHash
  , ", "
  , (case transactionChainId of
       Nothing -> ""
       Just c -> T.concat ["in chain", tshow c])
  , " with address: "
  , tshow address
  , " with "
  , tshow (maybe 0 M.size storage)
  , " items\n"
  , "    codeHash = "
  , tshow codeHash
  , "\n"
  , "    sourcePtr = "
  , tshow sourcePtr
  ]
  where tshow :: Show a => a -> Text
        tshow = T.pack . show
