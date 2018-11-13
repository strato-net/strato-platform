{-# OPTIONS_GHC -fno-warn-orphans #-}
module BlockApps.Solidity.Struct where

import           Control.DeepSeq
import           Data.LargeWord
import           Data.Map.Ordered        (OMap, assocs)
import           Data.Text               (Text)
import           GHC.Generics

import           BlockApps.Ethereum ()
import           BlockApps.Solidity.Type
import qualified BlockApps.Storage       as Storage

instance (NFData a, NFData b) => NFData (OMap a b) where
  rnf = rnf . assocs

data Struct = Struct { fields::OMap Text (Either Text Storage.Position, Type)
                     , size::Word256
                     } deriving (Show, Generic, NFData)
