{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Blockstanbul.Authentication
  ( module Blockchain.Blockstanbul.Authentication
  , module Blockchain.Blockstanbul.Model.Authentication
  ) where

import Control.Applicative ((<|>))
import Control.Monad (liftM2, liftM3, unless)
import Control.Lens as L
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
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.Block
import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1




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
getValidatorList x = L.view (istanbul . _Just . validatorList) (cookRawExtra $ L.view extraLens x )

getProposerSeal :: Block -> Maybe Signature
getProposerSeal x = do
  ist <- L.view istanbul . cookRawExtra . L.view extraLens $ x
  sig <- L.view proposedSig ist
  return sig

addProposerSeal :: Signature -> Block -> Block
addProposerSeal sig = over extraLens $
    uncookRawExtra
  . over istanbul (\i -> fmap (set proposedSig (Just sig)) i
                     <|> error "must set validators before proposer seal")
  . cookRawExtra

addCommitmentSeals :: [Signature] -> Block -> Block
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


proposalMessage :: Block -> B.ByteString
-- TODO(tim): Clear everything out of extraData except vanity and validators
proposalMessage = keccak256ToByteString
                . hash
                . rlpSerialize
                . rlpEncode
                . over extraDataLens scrubAllSeals
                . blockBlockData



proposerSeal :: (HasVault m) => Block -> m (Signature)
proposerSeal blk =
  let mesg = proposalMessage blk
  in sign mesg


verifyProposerSeal :: Block -> Signature -> Maybe Address
verifyProposerSeal blk sig =
  let mesg = proposalMessage blk
  in fromPublicKey <$> recoverPub sig mesg

commitmentMessage :: Keccak256 -> B.ByteString
commitmentMessage dig = keccak256ToByteString . hash . (<> B.singleton 2) . keccak256ToByteString $ dig

commitmentSeal :: (HasVault m) => Keccak256 -> m (Signature)
commitmentSeal sha =
  let mesg = commitmentMessage sha
  in sign mesg

verifyCommitmentSeal :: Keccak256 -> Signature -> Maybe Address
verifyCommitmentSeal sha sig =
  let mesg = commitmentMessage sha
  in fromPublicKey <$> recoverPub sig mesg

finalHash :: Block -> Keccak256
finalHash = hash
          . rlpSerialize
          . rlpEncode
          . over extraDataLens scrubCommitmentSeals
          . blockBlockData

signBenfInfo  :: (HasVault m) => (Address, Bool, Int) -> m (Signature)
signBenfInfo bnf =
  let mesg = keccak256ToByteString $ hash $ BL.toStrict $ encode (bnf)
  in sign mesg

verifyBenfInfo :: (Address, Bool, Int) -> Signature -> Maybe Address
verifyBenfInfo bnf sig =
  let mesg = keccak256ToByteString $ hash $ BL.toStrict $ encode (bnf)
  in fromPublicKey <$> recoverPub sig mesg

signMessage :: (StateMachineM m) => TrustedMessage -> m (OutEvent)
signMessage tm = do
  let mesg = getHash tm
  addr <- use selfAddr
  sig <- sign mesg
  return $ OMsg (MsgAuth addr sig) $ tm

authenticate :: InEvent -> Bool
authenticate (IMsg (MsgAuth addr sig) tm) =
  let msgHash = getHash tm
      mKey = recoverPub sig msgHash
      mAddress = fromPublicKey <$> mKey
  in mAddress == Just addr
authenticate _ = True -- Non-messages are trusted implicitly

replayHistoricBlock :: S.Set Address  -> Word256 -> Block -> Either String (Word256, Address)
replayHistoricBlock realValidators seqNo blk = do
  let ExtraData{..} = cookRawExtra . L.view extraLens $ blk
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
isHistoricBlock = (> 32) . B.length . L.view extraLens

