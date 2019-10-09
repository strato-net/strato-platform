{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Blockstanbul.Authentication
  ( module Blockchain.Blockstanbul.Authentication
  , module Blockchain.Blockstanbul.Model.Authentication
  ) where

import Control.Applicative ((<|>))
import Control.Monad (liftM2, liftM3, unless)
import Control.Lens
import Data.Binary
import Data.List (intercalate)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Maybe (mapMaybe)
import qualified Data.Set as S
import Test.QuickCheck
import Text.Printf

import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Data.Block
import Blockchain.Data.BlockDB(blockHash)
import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.ExtendedECDSA
import Blockchain.FastECRecover
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.SHA
import qualified Network.Haskoin.Crypto as HK

instance Arbitrary IstanbulExtra where
  arbitrary = liftM3 IstanbulExtra arbitrary arbitrary arbitrary

instance Arbitrary ExtraData where
  arbitrary = liftM2 ExtraData arbitrary arbitrary


truncateExtra :: Block -> Block
truncateExtra = over extraLens scrubConsensus

addValidators :: S.Set Address -> Block -> Block
addValidators vs = over extraLens $
    uncookRawExtra
  . set istanbul (Just (IstanbulExtra (S.toList vs) Nothing []))
  . cookRawExtra

getValidatorList :: Block -> [Address]
getValidatorList x = view (istanbul . _Just . validatorList) (cookRawExtra $ view extraLens x )

getProposerSeal :: Block -> Maybe ExtendedSignature
getProposerSeal x = do
  ist <- view istanbul . cookRawExtra . view extraLens $ x
  sig <- view proposedSig ist
  return sig

addProposerSeal :: ExtendedSignature -> Block -> Block
addProposerSeal sig = over extraLens $
    uncookRawExtra
  . over istanbul (\i -> fmap (set proposedSig (Just sig)) i
                     <|> error "must set validators before proposer seal")
  . cookRawExtra

addCommitmentSeals :: [ExtendedSignature] -> Block -> Block
addCommitmentSeals sigs = over extraLens $
    uncookRawExtra
  . over istanbul (\i -> fmap (set commitment sigs) i
                     <|> error "must set validators before commitment seals")
  . cookRawExtra

scrubAllSeals :: RawExtraData -> RawExtraData
scrubAllSeals = uncookRawExtra
              . set (istanbul . _Just . proposedSig) Nothing
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

proposerSeal :: Block -> HK.PrvKey -> ExtendedSignature
proposerSeal blk pk =
  let msg = proposalMessage blk
  in detExtSignMsg msg pk


verifyProposerSeal :: Block -> ExtendedSignature -> Maybe Address
verifyProposerSeal blk sig =
  let msg = proposalMessage blk
  in pubKey2Address <$> getPubKeyFromSignature_fast sig msg

commitmentMessage :: SHA -> HK.Word256
commitmentMessage (SHA dig) = unSHA . hash . (<> B.singleton 2) . word256ToBytes $ dig

commitmentSeal :: SHA -> HK.PrvKey -> ExtendedSignature
commitmentSeal sha pk =
  let msg = commitmentMessage sha
  in detExtSignMsg msg pk

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

signBenfInfo  :: HK.PrvKey -> (Address, Bool, Int) -> ExtendedSignature
signBenfInfo pk bnf =
  let msg = unSHA . hash . BL.toStrict $ encode (bnf)
      -- addr = prvKey2Address pk
  in detExtSignMsg msg pk

verifyBenfInfo :: (Address, Bool, Int) -> ExtendedSignature -> Maybe Address
verifyBenfInfo bnf sign =
  let msg = unSHA . hash . BL.toStrict $ encode (bnf)
  in pubKey2Address <$> getPubKeyFromSignature_fast sign msg

signMessage :: HK.PrvKey -> TrustedMessage -> OutEvent
signMessage pk tm =
  let msg = getHash tm
      addr = prvKey2Address pk
      sig = detExtSignMsg msg pk
  in OMsg (MsgAuth addr sig) $ tm

authenticate :: InEvent -> Bool
authenticate (IMsg (MsgAuth addr sig) tm) =
  let msgHash = getHash tm
      mKey = getPubKeyFromSignature sig msgHash
      mAddress = pubKey2Address <$> mKey
  in mAddress == Just addr
authenticate _ = True -- Non-messages are trusted implicitly

replayHistoricBlock :: S.Set Address  -> Word256 -> Block -> Either String (Word256, Address)
replayHistoricBlock realValidators seqNo blk = do
  let ExtraData{..} = cookRawExtra . view extraLens $ blk
  IstanbulExtra{..} <- case _istanbul of
    Nothing -> Left "no istanbul metadata"
    Just ist -> Right ist
  let mProp = verifyProposerSeal blk =<< _proposedSig
      signers = S.fromList
              . mapMaybe (verifyCommitmentSeal (blockHash blk))
              $ _commitment
      blockNo = fromIntegral . blockDataNumber . blockBlockData $ blk
  unless (seqNo + 1 == blockNo) $
    Left $ printf "unexpected block number: have %d, wanted %d" blockNo (seqNo + 1)
  unless (realValidators == S.fromList _validatorList) $
    Left "mismatched validators"
  prop <- maybe (Left "invalid proposer seal") Right mProp
  unless (prop `S.member` realValidators) $
    Left . printf "proposer %s not a validator" . formatAddressWithoutColor $ prop
  unless (signers `S.isSubsetOf` realValidators) $ do
    let unexplained = intercalate "," . map formatAddressWithoutColor . S.toList $ signers S.\\ realValidators
    Left $ "unknown signers: " ++ unexplained
  unless (3 * S.size signers > 2 * S.size realValidators) $
    Left $ printf "not enough commit seals (have %d out of %d)" (S.size signers) (S.size realValidators)
  Right (fromIntegral $ seqNo + 1, prop)

isHistoricBlock :: Block -> Bool
isHistoricBlock = (> 32) . B.length . view extraLens
