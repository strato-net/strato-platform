{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Blockstanbul.Messages where

import BlockApps.Logging
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.RLP
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Control.Lens
import Control.Monad (liftM2)
import qualified Data.Aeson as Ae
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as LB
import Data.Data
import Data.Default
import Data.Text
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Arbitrary.Generic
import qualified Text.Colors as CL
import Text.Format
import Text.Printf

type ValidatorRestriction = Bool

type RoundNumber = Word256

type SequenceNumber = Word256

data View = View
  { _round :: RoundNumber,
    _sequence :: SequenceNumber
  }
  deriving (Eq, Show, Ord, Generic, Binary, NFData, Data)

makeLenses ''View

instance Ae.ToJSON View where
  toJSON View {..} = Ae.object ["round" Ae..= _round, "sequence" Ae..= _sequence]

instance Ae.FromJSON View where
  parseJSON = Ae.withObject "View" $ \v -> liftM2 View (v Ae..: "round") (v Ae..: "sequence")

instance Format View where
  format (View r s) = printf "View (round = %d, sequence = %d)" r s

data MsgAuth = MsgAuth
  { sender :: ChainMemberParsedSet,
    signature :: Signature
  }
  deriving (Eq, Show, Generic, Binary, NFData, Data)

data TrustedMessage
  = Preprepare View Block
  | Prepare View Keccak256
  | Commit View Keccak256 Signature
  | RoundChange {roundchangeView :: View, roundchangeNonce :: Word256}
  deriving (Eq, Show, Generic, Binary, NFData)

instance Format TrustedMessage where
  format (Preprepare v theBlock) = CL.blue "PRE_PREPARE " ++ format v ++ " " ++ format (blockHash theBlock)
  format (Prepare v theSHA) = CL.blue "PREPARE " ++ format v ++ " " ++ format theSHA
  format (Commit v theSHA _) = CL.blue "COMMIT " ++ format v ++ " " ++ format theSHA
  format (RoundChange v n) = CL.blue "ROUNDCHANGE " ++ format v ++ " " ++ show n

data MessageKind = PreprepareK | PrepareK | CommitK | RoundChangeK deriving (Eq, Show, Enum, Generic)

categorize :: TrustedMessage -> MessageKind
categorize = \case
  Preprepare {} -> PreprepareK
  Prepare {} -> PrepareK
  Commit {} -> CommitK
  RoundChange {} -> RoundChangeK

data WireMessage = WireMessage
  { _msgAuth :: MsgAuth,
    _message :: TrustedMessage
  }
  deriving (Eq, Show, Generic, Binary, NFData)

makeLenses ''WireMessage

-- TODO: Allow changing blockstanbul admins without a restart
data ForcedConfigChange = ForcedRound RoundNumber
                        | ForcedSequence SequenceNumber
  deriving (Eq, Show, Generic, Binary, NFData, Data)

instance Format ForcedConfigChange where
  format = show

data ForcedValidatorChange = ForcedValidator ValidatorRestriction
  deriving (Eq, Show, Generic, Binary, NFData, Data)

instance Format ForcedValidatorChange where
  format = show

data PreprepareDecision = AcceptPreprepare Keccak256 | RejectPreprepare
  deriving (Eq, Show, Generic, Binary, NFData, Data)

instance Format PreprepareDecision where
  format (AcceptPreprepare h) = "AcceptPreprepare " <> format h
  format dec = show dec

blockstanbulSender :: WireMessage -> ChainMemberParsedSet
blockstanbulSender (WireMessage a _) = sender a

instance Arbitrary MsgAuth where
  arbitrary = genericArbitrary

instance Arbitrary View where
  arbitrary = genericArbitrary

instance Arbitrary TrustedMessage where
  arbitrary = genericArbitrary

instance Arbitrary WireMessage where
  arbitrary = genericArbitrary

instance Arbitrary ForcedConfigChange where
  arbitrary = genericArbitrary

instance Arbitrary ForcedValidatorChange where
  arbitrary = genericArbitrary

instance Arbitrary PreprepareDecision where
  arbitrary = genericArbitrary

instance Format WireMessage where
  format (WireMessage (MsgAuth s _) msg) = format msg ++ " " ++ format s

preprepareCode, prepareCode, commitCode, roundchangeCode :: Integer
preprepareCode = 0
prepareCode = 1
commitCode = 2
roundchangeCode = 3

data InEvent
  = IMsg {iAuth :: MsgAuth, iMessage :: TrustedMessage}
  | Timeout RoundNumber
  | UnannouncedBlock Block
  | PreviousBlock Block
  | PreprepareResponse PreprepareDecision
  | ForcedConfigChange ForcedConfigChange
  | ValidatorBehaviorChange ForcedValidatorChange
  | ValidatorChange Validator Bool 
  deriving (Eq, Show)

instance Format InEvent where
  format (IMsg (MsgAuth s _) msg) = "IMsg " ++ format msg ++ " " ++ format s
  format (Timeout rn) = "Timeout " ++ format rn
  format (UnannouncedBlock blk) = "UnannouncedBlock " ++ format (blockHash blk)
  format (PreprepareResponse rspns) = "Preprepare Response " ++ format rspns
  format (PreviousBlock blk) = "PreviousBlock " ++ format (blockHash blk)
  format (ForcedConfigChange cc) = "ForcedConfigChange " ++ format cc
  format (ValidatorBehaviorChange theBool) = "ValidatorBehaviorChange " ++ format theBool
  format (ValidatorChange val theBool) = "ValidatorChange " ++ format val ++ if theBool then " added" else " removed"

data OutEvent
  = OMsg {oAuth :: MsgAuth, oMessage :: TrustedMessage}
  | ToCommit Block
  | FailedHistoric Block
  | MakeBlockCommand
  | ResetTimer RoundNumber
  | -- Announce that the global consensus is ahead of us by
    -- some number of blocks, and hope that a higher power
    -- will erase the gap with PreviousBlocks.
    GapFound {have :: Integer, require :: Integer, peer :: ChainMemberParsedSet}
  | LeadFound {weHave :: Integer, theyHave :: Integer, peer :: ChainMemberParsedSet}
  | NewCheckpoint Checkpoint
  | RunPreprepare Block
  deriving (Eq, Show, Generic)

type EOutEvent = Either OutEvent OutEvent

fromE :: Either a a -> a
fromE = either id id

instance Format OutEvent where
  format (OMsg (MsgAuth s _) msg) = "OMsg " ++ format msg ++ " " ++ format s
  format (ToCommit blk) = "ToCommit " ++ format (blockHash blk)
  format (FailedHistoric blk) = "FailedHistoric " ++ format (blockHash blk)
  format MakeBlockCommand = "MakeBlockCommand"
  format (ResetTimer rn) = "ResetTimer " ++ format rn
  format (GapFound we they p) = "GapFound " ++ show (we, they, p)
  format (LeadFound we they p) = "LeadFound " ++ show (we, they, p)
  format (NewCheckpoint ckpt) = "NewCheckpoint " ++ show ckpt
  format (RunPreprepare blk) = "RunPreprepare " ++ format (blockHash blk)

blkNum :: Block -> String
blkNum = show . number . blockBlockData

shortFormat :: WireMessage -> String
shortFormat (WireMessage (MsgAuth s _) (Preprepare v blk)) =
  CL.blue "PRE_PREPARE " ++ format v ++ " " ++ format s ++ " #" ++ blkNum blk
shortFormat wm = format wm

inShortLog :: MonadLogger m => Text -> InEvent -> m ()
inShortLog loc iev = $logInfoS loc . pack $
  case iev of
    IMsg a m -> shortFormat $ WireMessage a m
    Timeout rn -> CL.blue "TIMEOUT " ++ show rn
    UnannouncedBlock blk -> CL.blue "UNANNOUNCED_BLOCK " ++ blkNum blk
    PreprepareResponse rspns -> CL.blue "PRE_PREPARE_RESPONSE " ++ format rspns
    PreviousBlock blk -> CL.blue "PREVIOUS_BLOCK " ++ blkNum blk
    ForcedConfigChange cc -> CL.blue "FORCED_CONFIG_CHANGE " ++ format cc
    ValidatorBehaviorChange vc -> CL.blue "VALIDATOR_BEHAVIOR_CHANGE " ++ show vc
    ValidatorChange val dir -> CL.blue "VALIDATOR_CHANGE " ++ format val ++ if dir then " ADDED" else " REMOVED"

outShortLog :: MonadLogger m => Text -> EOutEvent -> m ()
outShortLog loc eoev = do
  let prefix = either (const $ CL.red "GOSSIP ") (const "") eoev
  $logInfoS loc . pack $
    case fromE eoev of
      OMsg a m -> shortFormat $ WireMessage a m
      ToCommit blk -> prefix ++ CL.blue "TO_COMMIT " ++ blkNum blk
      FailedHistoric blk -> prefix ++ CL.blue "FAILED_HISTORIC " ++ blkNum blk
      MakeBlockCommand -> prefix ++ CL.blue "MAKE_BLOCK_COMMAND"
      ResetTimer rn -> prefix ++ CL.blue "RESET_TIMER " ++ show rn
      GapFound h r p -> prefix ++ CL.blue "GAP_FOUND " ++ format p ++ " " ++ show h ++ " " ++ show r
      LeadFound h r p -> prefix ++ CL.blue "LEAD_FOUND " ++ format p ++ " " ++ show h ++ " " ++ show r
      NewCheckpoint ckpt -> prefix ++ CL.blue "NEW_CHECKPOINT " ++ show ckpt
      RunPreprepare blk -> prefix ++ CL.blue "RUN_PRE_PREPARE " ++ format (blockHash blk)

instance NFData OutEvent

getHash :: TrustedMessage -> B.ByteString
-- This is wrong, because this means that the prepare and commits
-- will have the same signature despite being different messages.
-- It also needs a code for the message type.
getHash = \case
  (Preprepare _ blk) -> keccak256ToByteString . blockHash $ blk
  (Prepare _ di) -> keccak256ToByteString di
  (Commit _ di _) -> keccak256ToByteString di
  (RoundChange _ _) -> keccak256ToByteString $ hash "TODO(tim): this signature is predictable"

instance RLPSerializable View where
  rlpEncode (View r s) = RLPArray [rlpEncode r, rlpEncode s]
  rlpDecode (RLPArray [rlpr, rlps]) = View (rlpDecode rlpr) (rlpDecode rlps)
  rlpDecode x = error $ "cannot rlpDecode value as as View: " ++ show x

instance RLPSerializable WireMessage where
  rlpEncode (WireMessage (MsgAuth addr sig) (Preprepare vw blk)) =
    RLPArray
      [ rlpEncode preprepareCode,
        RLPString . rlpSerialize . RLPArray $
          [ rlpEncode vw,
            rlpEncode blk
          ],
        rlpEncode addr,
        rlpEncode sig,
        RLPString ""
      ]
  rlpEncode (WireMessage (MsgAuth addr sig) (Prepare vw digest)) =
    RLPArray
      [ rlpEncode prepareCode,
        RLPString . rlpSerialize . RLPArray $
          [ rlpEncode vw,
            rlpEncode digest
          ],
        rlpEncode addr,
        rlpEncode sig,
        RLPString ""
      ]
  rlpEncode (WireMessage (MsgAuth addr sig) (Commit vw digest seal)) =
    RLPArray
      [ rlpEncode commitCode,
        RLPString . rlpSerialize . RLPArray $
          [ rlpEncode vw,
            rlpEncode digest
          ],
        rlpEncode addr,
        rlpEncode sig,
        rlpEncode seal
      ]
  rlpEncode (WireMessage (MsgAuth addr sig) (RoundChange vw n)) =
    RLPArray
      [ rlpEncode roundchangeCode,
        RLPString . rlpSerialize . RLPArray $
          [ rlpEncode vw,
            rlpEncode n
          ],
        rlpEncode addr,
        rlpEncode sig,
        RLPString ""
      ]
  rlpDecode (RLPArray [code, RLPString payload, addr, sig, seals]) =
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
                RLPArray [vw, n] -> RoundChange (rlpDecode vw) (rlpDecode n)
                _ -> error $ "invalid rlp payload for roundchange: " ++ show body
            _ -> error $ "invalid code for blockstanbul message: " ++ show code
  rlpDecode x = error $ "invalid rlp for blockstanbul message: " ++ show x

-- While it is of course possible to rlpEncode inevents and rlpdecode
-- outevents (they are isomorphic on the parts that can be encoded),
-- the intent is that if you are trying to encode an InEvent you
-- have made a mistake.
instance RLPSerializable InEvent where
  rlpEncode _ = error "cannot rlpencode InEvents"
  rlpDecode x =
    let WireMessage a m = rlpDecode x
     in IMsg a m

instance RLPSerializable OutEvent where
  rlpDecode _ = error "cannot rlpdecode OutEvents"
  rlpEncode (OMsg a m) = rlpEncode (WireMessage a m)
  rlpEncode x = error $ "cannot rlpencode non-message OutEvent: " ++ show x

data AuthResult = AuthSuccess | AuthFailure String deriving (Show, Eq)

data Checkpoint = Checkpoint
  { checkpointView :: View,
    checkpointValidators :: [Validator]
  }
  deriving (Show, Eq, Generic, NFData, Ae.ToJSON, Ae.FromJSON, Data)

instance Binary Checkpoint where

instance Default Checkpoint where
  def = Checkpoint (View 0 0) []

instance Arbitrary Checkpoint where
  arbitrary = genericArbitrary

-- JSON was chosen to allow manual inspection and override during outages
encodeCheckpoint :: Checkpoint -> B.ByteString
encodeCheckpoint = LB.toStrict . Ae.encode

decodeCheckpoint :: B.ByteString -> Either String Checkpoint
decodeCheckpoint = Ae.eitherDecode . LB.fromStrict
