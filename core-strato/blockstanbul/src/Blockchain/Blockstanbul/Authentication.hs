{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.Authentication where

import Control.Monad (liftM2, liftM3)
import Control.Monad.IO.Class
import Control.Lens
import qualified Data.ByteString as B
import Data.Monoid ((<>))
import MonadUtils (liftIO1)
import Test.QuickCheck

import Blockchain.Blockstanbul.Messages
import Blockchain.Data.Address
import Blockchain.Data.BlockDB()
import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.ExtendedECDSA
import Blockchain.FastECRecover
import Blockchain.SHA
import Blockchain.Strato.Model.ExtendedWord
import qualified Network.Haskoin.Crypto as HK

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


instance Arbitrary IstanbulExtra where
  arbitrary = liftM3 IstanbulExtra arbitrary arbitrary arbitrary

instance Arbitrary ExtraData where
  arbitrary = liftM2 ExtraData arbitrary arbitrary

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

scrubAllSeals :: RawExtraData -> RawExtraData
scrubAllSeals = uncookRawExtra
              . set (istanbul . _Just . proposedSig) Nothing
              . set (istanbul . _Just . commitment) []
              . cookRawExtra

scrubCommitmentSeals :: RawExtraData -> RawExtraData
scrubCommitmentSeals = uncookRawExtra
                     . set (istanbul . _Just . commitment) []
                     . cookRawExtra

proposalMessage :: Block -> HK.Word256
-- TODO(tim): Clear everything out of extraData except vanity and validators
proposalMessage = unSHA
                . hash
                . rlpSerialize
                . rlpEncode
                . over extraDataLens scrubAllSeals
                . blockBlockData

proposerSeal :: (MonadIO m) => Block -> HK.PrvKey -> m ExtendedSignature
proposerSeal blk pk =
  let msg = proposalMessage blk
  in HK.withSource (liftIO1 HK.devURandom) $ extSignMsg msg pk


verifyProposerSeal :: Block -> ExtendedSignature -> Maybe Address
verifyProposerSeal blk sig =
  let msg = proposalMessage blk
  in pubKey2Address <$> getPubKeyFromSignature_fast sig msg

commitmentMessage :: SHA -> HK.Word256
commitmentMessage (SHA dig) = unSHA . hash . B.pack . (++[2]) . word256ToBytes $ dig

commitmentSeal :: (MonadIO m) => SHA -> HK.PrvKey -> m ExtendedSignature
commitmentSeal sha pk =
  let msg = commitmentMessage sha
  in HK.withSource (liftIO1 HK.devURandom) $ extSignMsg msg pk

verifyCommitmentSeal :: SHA -> ExtendedSignature -> Maybe Address
verifyCommitmentSeal sha sig =
  let msg = commitmentMessage sha
  in pubKey2Address <$> getPubKeyFromSignature_fast sig msg

finalHash :: Block -> SHA
finalHash = hash
          . rlpSerialize
          . rlpEncode
          . over extraDataLens scrubCommitmentSeals
          . blockBlockData

signMessage :: (MonadIO m) => HK.PrvKey -> WireMessage -> m WireMessage
signMessage pk wm = do
  let msg = getHash wm
      addr = prvKey2Address pk
  sig <- HK.withSource (liftIO1 HK.devURandom) $ extSignMsg msg pk
  let auth = MsgAuth addr sig
  return $ case wm of
      Preprepare _ b c -> Preprepare auth b c
      Prepare _ b c -> Prepare auth b c
      Commit _ b c d -> Commit auth b c d
      RoundChange _ b -> RoundChange auth b

authenticate :: WireMessage -> Bool
authenticate msg =
  let MsgAuth addr sig = getAuth msg
      msgHash = getHash msg
      mKey = getPubKeyFromSignature sig msgHash
      mAddress = pubKey2Address <$> mKey
  in mAddress == Just addr
