{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
module Blockchain.Blockstanbul.Messages where

import Control.Lens
import Control.Monad
import Data.Text
import Test.QuickCheck

import Blockchain.Data.RLP
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
                                roundchangeView :: View }
                 deriving (Eq, Show)

preprepareCode, prepareCode, commitCode, roundchangeCode :: Integer
preprepareCode = 0
prepareCode = 1
commitCode = 2
roundchangeCode = 3

data InEvent = IMsg {unIMsg :: WireMessage}
             | Timeout
             | CommitResult (Either Text ())
             | NewBlock Block
             deriving (Eq, Show)

data OutEvent = OMsg {unOMsg :: WireMessage}
              | ReadyBlock Block
              deriving (Eq, Show)

getAuth :: WireMessage -> MsgAuth
getAuth (Preprepare a _ _) = a
getAuth (Prepare a _ _) = a
getAuth (Commit a _ _ _) = a
getAuth (RoundChange a _) = a

getHash :: WireMessage -> Word256
-- This is wrong, because this means that the prepare and commits
-- will have the same signature despite being different messages.
-- It also needs a code for the message type.
getHash (Preprepare _ _ blk) = unSHA . blockHash $ blk
getHash (Prepare _ _ di) = unSHA di
getHash (Commit _ _ di _) = unSHA di
getHash (RoundChange _ _) = unSHA $ hash "TODO(tim): this signature is predictable"

-- TODO(tim): JSON instances


instance RLPSerializable View where
  rlpEncode (View r s) = RLPArray [rlpEncode r, rlpEncode s]
  rlpDecode (RLPArray [rlpr, rlps]) = View (rlpDecode rlpr) (rlpDecode rlps)
  rlpDecode x = error $ "cannot rlpDecode value as as View: " ++ show x

instance RLPSerializable WireMessage where
  rlpEncode (Preprepare (MsgAuth addr sig) vw blk) = RLPArray
      [ rlpEncode preprepareCode
      , RLPString . rlpSerialize . RLPArray $
        [ rlpEncode vw
        , rlpEncode blk ]
      , rlpEncode addr
      , rlpEncode sig
      , RLPString ""]
  rlpEncode (Prepare (MsgAuth addr sig) vw digest) = RLPArray
      [ rlpEncode prepareCode
      , RLPString . rlpSerialize . RLPArray $
        [ rlpEncode vw
        , rlpEncode digest ]
      , rlpEncode addr
      , rlpEncode sig
      , RLPString ""]
  rlpEncode (Commit (MsgAuth addr sig) vw digest seal) = RLPArray
      [ rlpEncode commitCode
      , RLPString . rlpSerialize . RLPArray $
        [ rlpEncode vw
        , rlpEncode digest ]
      , rlpEncode addr
      , rlpEncode sig
      , rlpEncode seal ]
  rlpEncode (RoundChange (MsgAuth addr sig) vw) = RLPArray
      [ rlpEncode roundchangeCode
      , RLPString . rlpSerialize . RLPArray $
        [ rlpEncode vw,
          rlpEncode $ SHA 0]
      , rlpEncode addr
      , rlpEncode sig
      , RLPString ""]
  rlpDecode (RLPArray [code, (RLPString payload), addr, sig, seals ]) =
      let auth = MsgAuth (rlpDecode addr) (rlpDecode sig)
          body = rlpDeserialize payload
      in case (rlpDecode code :: Integer) of
          0 ->
            case body of
                RLPArray [vw, blk] -> Preprepare auth (rlpDecode vw) (rlpDecode blk)
                _ -> error $ "invalid rlp payload for preprepare: " ++ show body
          1 ->
            case body of
                RLPArray [vw, digest] -> Prepare auth (rlpDecode vw) (rlpDecode digest)
                _ -> error $ "invalid rlp payload for preprepare: " ++ show body
          2 ->
            case body of
                RLPArray [vw, digest] -> Commit auth (rlpDecode vw) (rlpDecode digest) (rlpDecode seals)
                _ -> error $ "invalid rlp payload for commit: " ++ show body

          3 ->
            case body of
                RLPArray [vw, _] -> RoundChange auth (rlpDecode vw)
                _ -> error $ "invalid rlp payload for roundchange: " ++ show body

          _ -> error $ "invalid code for blockstanbul message: " ++ show code
  rlpDecode x = error $ "invalid rlp for blockstanbul message: " ++ show x
