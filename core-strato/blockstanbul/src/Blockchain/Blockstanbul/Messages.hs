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

data View = View {
  viewRound :: Word256,
  viewSequence :: Word256
} deriving (Eq, Show, Ord)

data MsgAuth = MsgAuth {
  sender :: Address,
  signature :: ExtendedSignature
} deriving (Eq, Show)

instance Arbitrary MsgAuth where
  arbitrary = liftM2 MsgAuth arbitrary arbitrary


data BlockstanbulEvent = Preprepare MsgAuth View Block
                       | Prepare MsgAuth View SHA
                       | Commit MsgAuth View SHA Seal
                       | RoundChange {roundchangeAuth :: MsgAuth,
                                      roundchangeView :: View}
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
