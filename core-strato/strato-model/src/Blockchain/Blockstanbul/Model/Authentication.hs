{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.Model.Authentication where

import Control.Lens
import qualified Data.ByteString as B
import Data.Monoid ((<>))

import Blockchain.Data.RLP
import Blockchain.ExtendedECDSA.Model.ExtendedSignature
import Blockchain.Strato.Model.Address

type RawExtraData = B.ByteString

data IstanbulExtra = IstanbulExtra {
  _validatorList :: [Address],
  _proposedSig :: Maybe ExtendedSignature,
  _commitment :: [ExtendedSignature]
} deriving (Eq, Show)
makeLenses ''IstanbulExtra

data ExtraData = ExtraData {
  _vanity :: B.ByteString,
  _istanbul :: Maybe IstanbulExtra
} deriving (Eq, Show)
makeLenses ''ExtraData

instance RLPSerializable IstanbulExtra where
  rlpEncode (IstanbulExtra vls mp cs) =
      RLPArray [RLPArray . map rlpEncode $ vls,
                maybe (RLPScalar 0) rlpEncode mp,
                RLPArray . map rlpEncode $ cs]
  rlpDecode (RLPArray [RLPArray rvls, rp, RLPArray rcs]) =
      IstanbulExtra (map rlpDecode rvls)
                    (case rp of
                        RLPScalar _ -> Nothing
                        _ -> Just . rlpDecode $ rp)
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
  in ExtraData vn $ if B.null rest
                      then Nothing
                      else Just . rlpDecode . rlpDeserialize $ rest

scrubCommitmentSeals :: RawExtraData -> RawExtraData
scrubCommitmentSeals = uncookRawExtra
                     . set (istanbul . _Just . commitment) []
                     . cookRawExtra

scrubConsensus :: RawExtraData -> RawExtraData
scrubConsensus = B.take 32
