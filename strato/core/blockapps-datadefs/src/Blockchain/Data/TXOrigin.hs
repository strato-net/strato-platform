{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.TXOrigin where

import Blockchain.Data.PersistTypes ()
import Blockchain.Strato.Model.Keccak256
import Data.Aeson
import Data.Binary
import Data.Data
import Database.Persist.TH
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Arbitrary.Generic
import Text.Format

data TXOrigin = Direct | API | Quarry | BlockHash Keccak256 | PeerString String | Morphism | Blockstanbul
  deriving (Show, Read, Eq, Generic, Data)

derivePersistField "TXOrigin"

instance ToJSON TXOrigin

instance FromJSON TXOrigin

instance Arbitrary TXOrigin where
  arbitrary = genericArbitrary

instance Binary TXOrigin where
  put Direct = putWord8 0
  put API = putWord8 1
  put Quarry = putWord8 4 -- this was added last, dont break backwards compat
  put Morphism = putWord8 5 -- this was added even later
  put (BlockHash sha) = putWord8 2 >> put sha
  put (PeerString p) = putWord8 3 >> put p
  put Blockstanbul = putWord8 6
  get = do
    tag <- getWord8
    case tag of
      0 -> return Direct
      1 -> return API
      2 -> BlockHash <$> get
      3 -> PeerString <$> get
      4 -> return Quarry
      5 -> return Morphism
      6 -> return Blockstanbul
      _ -> error "the impossible happened in get of Binary instance of TXOrigin"

instance Format TXOrigin where
  format (BlockHash sha) = "BlockHash " ++ keccak256ToHex sha
  format (PeerString p) = "Peer " ++ show p
  format x = show x
