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

type Seal = ()

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


data BlockstanbulEvent = Preprepare MsgAuth View Block
                       | Prepare MsgAuth View SHA
                       | Commit MsgAuth View SHA Seal
                       | RoundChange {roundchangeAuth :: MsgAuth,
                                      roundchangeRound :: RoundNumber }
                       | Timeout
                       | CommitFailure Text
                       deriving (Eq, Show)

getAuth :: BlockstanbulEvent -> Maybe MsgAuth
getAuth (Preprepare a _ _) = Just a
getAuth (Prepare a _ _) = Just a
getAuth (Commit a _ _ _) = Just a
getAuth (RoundChange a _) = Just a
getAuth _ = Nothing

getHash :: BlockstanbulEvent -> Maybe SHA
-- This is wrong, because this means that the prepare and commits
-- will have the same signature despite being different messages.
-- It also needs a code for the message type.
getHash (Preprepare _ _ blk) = Just . blockHash $ blk
getHash (Prepare _ _ di) = Just di
getHash (Commit _ _ di _) = Just di
getHash (RoundChange _ _) = error "not yet defined for roundchange"
getHash _ = Nothing

authenticate :: BlockstanbulEvent -> Bool
authenticate msg = case getAuth msg of
  Nothing -> True
  Just a ->
    let MsgAuth addr sig = a
        mMsgHash = getHash msg
        mKey = getPubKeyFromSignature sig . unSHA =<< mMsgHash
        mAddress = pubKey2Address <$> mKey
    in mAddress == Just addr

-- TODO(tim): JSON instances
-- TODO(tim): RLP instances
