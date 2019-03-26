{-# LANGUAGE DeriveGeneric   #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.TXOrigin where

import           Data.Binary
import           Data.Aeson
import           Database.Persist.TH

import           Blockchain.Data.PersistTypes ()
import           Blockchain.Strato.Model.SHA
import           Text.Format

import           GHC.Generics

data TXOrigin = Direct | API | Quarry | BlockHash SHA | PeerString String | Morphism | Blockstanbul deriving (Show, Read, Eq, Generic)

derivePersistField "TXOrigin"

instance ToJSON TXOrigin where
instance FromJSON TXOrigin where

instance Binary TXOrigin where
    put Direct          = putWord8 0
    put API             = putWord8 1
    put Quarry          = putWord8 4 -- this was added last, dont break backwards compat
    put Morphism        = putWord8 5 -- this was added even later
    put (BlockHash sha) = putWord8 2 >> put sha
    put (PeerString p)  = putWord8 3 >> put p
    put Blockstanbul    = putWord8 6
    get = do
        tag <- getWord8
        case tag of
            0 -> return Direct
            1 -> return API
            2 -> BlockHash  <$> get
            3 -> PeerString <$> get
            4 -> return Quarry
            5 -> return Morphism
            6 -> return Blockstanbul
            _ -> error "the impossible happened in get of Binary instance of TXOrigin"

instance Format TXOrigin where
    format (BlockHash sha) = "BlockHash " ++ shaToHex sha
    format (PeerString p ) = "Peer " ++ show p
    format               x = show x
