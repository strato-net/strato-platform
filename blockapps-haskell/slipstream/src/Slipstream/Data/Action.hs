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
#-}

module Slipstream.Data.Action where

import           BlockApps.Ethereum
import           Data.Map.Strict    (Map)
import qualified Data.Map.Strict    as M
import           Data.Text          (Text)
import qualified Data.Text          as T

data ActionType = Create | Delete | Update deriving (Eq,Show)

data SourcePtr = SourcePtr { sourceHash :: Text, contractName :: Text} deriving (Eq, Show)

data Action =
  Action{
    actionType :: ActionType,
    address :: Text,
    codeHash :: Text,
    sourcePtr :: Maybe SourcePtr,
    indexFlag :: Maybe Bool,
    historyFlag :: Maybe Bool,
    chainId :: Maybe ChainId,
    storage :: Maybe (Map Text Text)
    } deriving (Show)


formatAction :: Action -> Text
formatAction Action{..} = T.concat
  [ tshow actionType
  , " "
  , address
  , (case chainId of
       Nothing -> ""
       Just c -> T.concat ["in chain", tshow c])
  , " with "
  , tshow (maybe 0 M.size storage)
  , " items\n"
  , "    codeHash = "
  , codeHash
  , "\n"
  , "    sourcePtr = "
  , tshow sourcePtr
  ]
  where tshow :: Show a => a -> Text
        tshow = T.pack . show
