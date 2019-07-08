{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Init.Protocol (EventInit(..)) where

import Data.Aeson
import qualified Data.ByteString as B
import GHC.Generics

import Blockchain.EthConf
import Blockchain.Data.Json (Block')
import Blockchain.Data.ChainInfo (AccountInfo)

data EventInit = EthConf EthConf
               | PeerList [String]
               | GenesisBlock Block'
               | GenesisAccounts [AccountInfo]
               | ApiConfig [(FilePath, B.ByteString)]
               | InitComplete
               deriving (Show, Eq, Generic, ToJSON, FromJSON)
