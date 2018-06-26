module Blockchain.Blockstanbul.Messages where

import Control.Monad
import Data.Text

import Test.QuickCheck
import Blockchain.ExtWord
import Blockchain.Data.Address
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.DataDefs
import Blockchain.SHA
import Blockchain.ExtendedECDSA

type Seal = ()

data RoundId = RoundId {
  roundidRound :: Word256,
  roundidSequence :: Word256
} deriving (Eq, Show, Ord)

data MsgAuth = MsgAuth {
  sender :: Address,
  signature :: ExtendedSignature
} deriving (Eq, Show)

instance Arbitrary MsgAuth where
  arbitrary = liftM2 MsgAuth arbitrary arbitrary


data BlockstanbulEvent = Preprepare MsgAuth RoundId Block
                       | Prepare MsgAuth RoundId SHA
                       | Commit MsgAuth RoundId SHA Seal
                       | RoundChange {roundchangeAuth :: MsgAuth,
                                      roundchangeRound :: Word256}
                       | Timeout
                       | CommitFailure Text
                       deriving (Eq, Show)

getAuth :: BlockstanbulEvent -> Maybe MsgAuth
getAuth (Preprepare a _ _) = Just a
getAuth (Prepare a _ _) = Just a
getAuth (Commit a _ _ _) = Just a
getAuth (RoundChange a _) = Just a
getAuth _ = Nothing

-- TODO(tim): JSON instances
-- TODO(tim): RLP instances
