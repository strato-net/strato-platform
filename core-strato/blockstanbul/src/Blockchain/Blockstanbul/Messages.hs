{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.Messages where

import Control.Lens
import Control.Monad
import Data.Text

import Test.QuickCheck
import Blockchain.ExtWord
import Blockchain.Data.Address
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.BlockDB
import Blockchain.SHA
import Blockchain.ExtendedECDSA

type RoundNumber = Word256
type SequenceNumber = Word256
data View = View {
  _round :: RoundNumber,
  _sequence :: SequenceNumber
} deriving (Eq, Show, Ord)
makeLenses ''View

data MsgAuth = MsgAuth {
  sender :: Address,
  signature :: ExtendedSignature
} deriving (Eq, Show)

instance Arbitrary MsgAuth where
  arbitrary = liftM2 MsgAuth arbitrary arbitrary

data WireMessage = Preprepare MsgAuth View Block
                 | Prepare MsgAuth View SHA
                 | Commit MsgAuth View SHA ExtendedSignature
                 | RoundChange {roundchangeAuth :: MsgAuth,
                                roundchangeRound :: RoundNumber }
                 deriving (Eq, Show)

data InEvent = IMsg {unIMsg :: WireMessage}
             | Timeout
             | CommitFailure Text
             deriving (Eq, Show)

data OutEvent = OMsg {unOMsg :: WireMessage}
              | ReadyBlock Block
              deriving (Eq, Show)

getAuth :: WireMessage -> MsgAuth
getAuth (Preprepare a _ _) = a
getAuth (Prepare a _ _) = a
getAuth (Commit a _ _ _) = a
getAuth (RoundChange a _) = a

getHash :: WireMessage -> SHA
-- This is wrong, because this means that the prepare and commits
-- will have the same signature despite being different messages.
-- It also needs a code for the message type.
getHash (Preprepare _ _ blk) = blockHash $ blk
getHash (Prepare _ _ di) = di
getHash (Commit _ _ di _) = di
getHash (RoundChange _ _) = error "not yet defined for roundchange"

authenticate :: WireMessage -> Bool
authenticate msg =
  let MsgAuth addr sig = getAuth msg
      msgHash = getHash msg
      mKey = getPubKeyFromSignature sig . unSHA $ msgHash
      mAddress = pubKey2Address <$> mKey
  in mAddress == Just addr

-- TODO(tim): JSON instances
-- TODO(tim): RLP instances
