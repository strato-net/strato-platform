{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Blockstanbul.Model.Authentication where

import Blockchain.Data.RLP
-- import Blockchain.Strato.Model.Address

import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Secp256k1
import Control.Arrow ((&&&))
import Control.Lens
import qualified Data.ByteString as B

type RawExtraData = B.ByteString

data IstanbulExtra = IstanbulExtra
  { _validatorList :: ChainMembers,
    _proposedSig :: Maybe Signature,
    _commitment :: [Signature]
  }
  deriving (Eq, Show)

makeLenses ''IstanbulExtra

data ExtraData = ExtraData
  { _vanity :: B.ByteString,
    _istanbul :: Maybe IstanbulExtra
  }
  deriving (Eq, Show)

makeLenses ''ExtraData

instance RLPSerializable IstanbulExtra where
  rlpEncode (IstanbulExtra vls mp cs) =
    RLPArray
      [ rlpEncode $ vls,
        maybe (RLPScalar 0) rlpEncode mp,
        RLPArray . map rlpEncode $ cs
      ]
  rlpDecode (RLPArray [rvls, rp, RLPArray rcs]) =
    IstanbulExtra
      (rlpDecode rvls)
      ( case rp of
          RLPScalar _ -> Nothing
          _ -> Just . rlpDecode $ rp
      )
      (map rlpDecode rcs)
  rlpDecode x = error $ "invalid rlp for istanbul extra: " ++ show x

uncookRawExtra :: ExtraData -> RawExtraData
uncookRawExtra (ExtraData vn ist') =
  case ist' of
    Nothing -> B.take 32 vn
    Just ist -> B.take 32 vn <> B.replicate (32 - B.length vn) 0 <> rlpSerialize (rlpEncode ist)

cookRawExtra :: RawExtraData -> ExtraData
cookRawExtra bs =
  let (vn, rest) = B.splitAt 32 bs
   in ExtraData vn $
        if B.null rest
          then Nothing
          else Just . rlpDecode . rlpDeserialize $ rest

class Show h => HasIstanbulExtra h where
  getIstanbulExtra :: h -> Maybe IstanbulExtra
  putIstanbulExtra :: Maybe IstanbulExtra -> h -> h

runIstanbulExtra :: HasIstanbulExtra h => (Maybe IstanbulExtra -> (a, Maybe IstanbulExtra)) -> h -> (a, h)
runIstanbulExtra f h = let (a, mIst) = f $ getIstanbulExtra h
                         in (a, putIstanbulExtra mIst h)

evalIstanbulExtra :: HasIstanbulExtra h => (Maybe IstanbulExtra -> a) -> h -> a
evalIstanbulExtra f = fst . runIstanbulExtra (f &&& id)

execIstanbulExtra :: HasIstanbulExtra h => (Maybe IstanbulExtra -> Maybe IstanbulExtra) -> h -> h
execIstanbulExtra f = snd . runIstanbulExtra (((),) . f)

scrubConsensus :: HasIstanbulExtra h => h -> h
scrubConsensus = execIstanbulExtra (const Nothing)

scrubCommitmentSeals :: HasIstanbulExtra h => h -> h
scrubCommitmentSeals = execIstanbulExtra (set (_Just . commitment) [])