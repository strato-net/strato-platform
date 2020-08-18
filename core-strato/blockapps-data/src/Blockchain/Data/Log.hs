{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Data.Log (
  Log(..)
  ) where

import           Blockchain.Data.Address
import           Blockchain.MiscJSON       ()
import           Control.DeepSeq
import           Data.Aeson
import qualified Data.ByteString           as B
import           GHC.Generics
import           Network.Haskoin.Internals (Word256, Word512)

data Log =
  Log {
    address :: Address,
    bloom   :: Word512,
    logData :: B.ByteString,
    topics  :: [Word256]
    } deriving (Eq, Read, Show, Generic)

instance NFData Log
instance ToJSON Log
instance FromJSON Log

