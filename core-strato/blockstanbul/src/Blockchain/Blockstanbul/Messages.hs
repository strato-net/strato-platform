{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Blockstanbul.Messages where

import Control.DeepSeq
import Control.Lens
import Data.Binary
import Data.DeriveTH
import Data.Text
import GHC.Generics
import Test.QuickCheck
import Text.Printf

import Blockchain.Data.RLP
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.Data.Address
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.BlockDB
import Blockchain.ExtendedECDSA
import Blockchain.SHA
import qualified Blockchain.Strato.Model.Colors as CL

type RoundNumber = Word256
type SequenceNumber = Word256
data View = View {
  _round :: RoundNumber,
  _sequence :: SequenceNumber
} deriving (Eq, Show, Ord, Generic)
makeLenses ''View

instance Format View where
  format (View r s) = printf "View (round = %d, sequence = %d)" r s

data MsgAuth = MsgAuth {
  sender :: Address,
  signature :: ExtendedSignature
} deriving (Eq, Show, Generic)

data TrustedMessage = Preprepare View Block
                    | Prepare View SHA
                    | Commit View SHA ExtendedSignature
                    | RoundChange {roundchangeView :: View }
                    deriving (Eq, Show, Generic)

data WireMessage = WireMessage {
  _msgAuth :: MsgAuth,
  _message :: TrustedMessage
} deriving (Eq, Show, Generic)
makeLenses ''WireMessage

instance Binary MsgAuth where
instance Binary View where
instance Binary TrustedMessage where
instance Binary WireMessage where

instance NFData MsgAuth
instance NFData View
instance NFData TrustedMessage
instance NFData WireMessage

derive makeArbitrary ''MsgAuth
derive makeArbitrary ''View
derive makeArbitrary ''TrustedMessage
derive makeArbitrary ''WireMessage

instance Format WireMessage where
  format (WireMessage (MsgAuth s _) (Preprepare v theBlock)) = CL.blue "PRE_PREPARE " ++ format v ++ " " ++ format s ++ "\n" ++ format theBlock
  format (WireMessage (MsgAuth s _) (Prepare v theSHA)) = CL.blue "PREPARE " ++ format v ++ " " ++ format s ++ " " ++ format theSHA
  format (WireMessage (MsgAuth s _) (Commit v theSHA _)) = CL.blue "COMMIT " ++ format v ++ " " ++ format s ++ " " ++ format theSHA
  format (WireMessage (MsgAuth s _) (RoundChange v)) = CL.blue "ROUNDCHANGE " ++ format v ++ " " ++ format s

preprepareCode, prepareCode, commitCode, roundchangeCode :: Integer
preprepareCode = 0
prepareCode = 1
commitCode = 2
roundchangeCode = 3

data InEvent = IMsg {iAuth :: MsgAuth, iMessage :: TrustedMessage}
             | Timeout RoundNumber
             -- TODO(tim): CommitResult should have the digest
             | CommitResult (Either Text ())
             | UnannouncedBlock Block
             | PreviousBlock Block
             | NewBeneficiary {bAuth :: MsgAuth, beneficiary :: (Address, Bool,Int)}
             deriving (Eq, Show)

data OutEvent = OMsg {oAuth :: MsgAuth, oMessage :: TrustedMessage}
              | ToCommit Block
              | MakeBlockCommand
              | ResetTimer RoundNumber
              deriving (Eq, Show, Generic)

instance NFData OutEvent

getHash :: TrustedMessage -> Word256
-- This is wrong, because this means that the prepare and commits
-- will have the same signature despite being different messages.
-- It also needs a code for the message type.
getHash = \case
              (Preprepare _ blk) -> unSHA . blockHash $ blk
              (Prepare _ di) -> unSHA di
              (Commit _ di _) -> unSHA di
              (RoundChange _) -> unSHA $ hash "TODO(tim): this signature is predictable"

instance RLPSerializable View where
  rlpEncode (View r s) = RLPArray [rlpEncode r, rlpEncode s]
  rlpDecode (RLPArray [rlpr, rlps]) = View (rlpDecode rlpr) (rlpDecode rlps)
  rlpDecode x = error $ "cannot rlpDecode value as as View: " ++ show x

instance RLPSerializable WireMessage where
  rlpEncode (WireMessage (MsgAuth addr sig) (Preprepare vw blk)) = RLPArray
      [ rlpEncode preprepareCode
      , RLPString . rlpSerialize . RLPArray $
        [ rlpEncode vw
        , rlpEncode blk ]
      , rlpEncode addr
      , rlpEncode sig
      , RLPString ""]
  rlpEncode (WireMessage (MsgAuth addr sig) (Prepare vw digest)) = RLPArray
      [ rlpEncode prepareCode
      , RLPString . rlpSerialize . RLPArray $
        [ rlpEncode vw
        , rlpEncode digest ]
      , rlpEncode addr
      , rlpEncode sig
      , RLPString ""]
  rlpEncode (WireMessage (MsgAuth addr sig) (Commit vw digest seal)) = RLPArray
      [ rlpEncode commitCode
      , RLPString . rlpSerialize . RLPArray $
        [ rlpEncode vw
        , rlpEncode digest ]
      , rlpEncode addr
      , rlpEncode sig
      , rlpEncode seal ]
  rlpEncode (WireMessage (MsgAuth addr sig) (RoundChange vw)) = RLPArray
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
      in WireMessage auth $
        case (rlpDecode code :: Integer) of
            0 ->
              case body of
                  RLPArray [vw, blk] -> Preprepare (rlpDecode vw) (rlpDecode blk)
                  _ -> error $ "invalid rlp payload for preprepare: " ++ show body
            1 ->
              case body of
                  RLPArray [vw, digest] -> Prepare (rlpDecode vw) (rlpDecode digest)
                  _ -> error $ "invalid rlp payload for preprepare: " ++ show body
            2 ->
              case body of
                  RLPArray [vw, digest] -> Commit (rlpDecode vw) (rlpDecode digest) (rlpDecode seals)
                  _ -> error $ "invalid rlp payload for commit: " ++ show body
            3 ->
              case body of
                  RLPArray [vw, _] -> RoundChange (rlpDecode vw)
                  _ -> error $ "invalid rlp payload for roundchange: " ++ show body

            _ -> error $ "invalid code for blockstanbul message: " ++ show code
  rlpDecode x = error $ "invalid rlp for blockstanbul message: " ++ show x

-- While it is of course possible to rlpEncode inevents and rlpdecode
-- outevents (they are isomorphic on the parts that can be encoded),
-- the intent is that if you are trying to encode an InEvent you
-- have made a mistake.
instance RLPSerializable InEvent where
  rlpEncode _ = error "cannot rlpencode InEvents"
  rlpDecode x = let WireMessage a m = rlpDecode x
                in IMsg a m

instance RLPSerializable OutEvent where
  rlpDecode _ = error "cannot rlpdecode OutEvents"
  rlpEncode (OMsg a m) = rlpEncode (WireMessage a m)
  rlpEncode x = error $ "cannot rlpencode non-message OutEvent: " ++ show x
