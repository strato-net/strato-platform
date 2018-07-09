{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.Authentication where

import Control.Exception (SomeException, catch, evaluate)
import Control.Monad (liftM4)
import Control.Monad.IO.Class
import Control.Lens
import Crypto.Util (bs2i, i2bs_unsized)
import qualified Data.ByteString as B
import MonadUtils (liftIO1)
import System.IO.Unsafe (unsafePerformIO)
import Test.QuickCheck

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

type ExtraData = Integer

-- TODO(tim): Separate vanity out into the non-rlp encoded parts.
-- This is made difficult by extraData :: Integer, which means that
-- the vanity would need to be used in the lower 256 bits to preserve
-- a 0 vanity (or having a leading sentinal 1 bit).
data IstanbulExtra = IstanbulExtra {
  _vanity :: HK.Word256,
  _validators :: [Address],
  _proposal :: Maybe ExtendedSignature,
  _commitment :: [ExtendedSignature]
} deriving (Eq, Show)
makeLenses ''IstanbulExtra

instance Arbitrary IstanbulExtra where
  arbitrary = liftM4 IstanbulExtra arbitrary arbitrary arbitrary arbitrary

instance RLPSerializable IstanbulExtra where
  rlpEncode (IstanbulExtra vn vls mp cs) =
      RLPArray [rlpEncode vn,
                RLPArray . map rlpEncode $ vls,
                maybe (RLPScalar 0) rlpEncode mp,
                RLPArray . map rlpEncode $ cs]
  rlpDecode (RLPArray [rvn, RLPArray rvls, rp, RLPArray rcs]) =
      IstanbulExtra (rlpDecode rvn)
                    (map rlpDecode rvls)
                    (case rp of
                        RLPScalar _ -> Nothing
                        _ -> Just . rlpDecode $ rp)
                    (map rlpDecode rcs)
  rlpDecode (RLPScalar x) = IstanbulExtra (fromIntegral x) [] Nothing []
  rlpDecode (RLPString xs) = IstanbulExtra (fromIntegral . bs2i $ xs) [] Nothing []
  rlpDecode x = error $ "invalid rlp for istanbul extra: " ++ show x

-- Why the hell is extraData :: Integer
extra2Integer :: IstanbulExtra -> ExtraData
extra2Integer = bs2i . rlpSerialize . rlpEncode

integer2Extra :: ExtraData -> IstanbulExtra
integer2Extra n = let fallback :: SomeException -> IO IstanbulExtra
                      fallback = const . return $ IstanbulExtra (fromIntegral n) [] Nothing []
                      action :: IO IstanbulExtra
                      action = evaluate . rlpDecode . rlpDeserialize . i2bs_unsized $ n
                  -- TODO(tim): is backwards compatibility worth the unsafety of
                  -- suppressing rlp errors?
                  in unsafePerformIO $ catch action fallback

scrubAllSeals :: ExtraData -> ExtraData
scrubAllSeals = extra2Integer . set proposal Nothing . set commitment [] . integer2Extra

scrubCommitmentSeals :: ExtraData -> ExtraData
scrubCommitmentSeals = extra2Integer . set commitment [] . integer2Extra

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
