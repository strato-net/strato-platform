{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Blockstanbul.Authentication (
    signMessage,
    proposerSeal,
    addProposerSeal,
    addValidators,
    commitmentSeal,
    addCommitmentSeals,
    authenticate,
    verifyProposerSeal,
    getProposerSeal,
    verifyCommitmentSeal,
    replayHistoricBlock,
    scrubConsensus,
    isHistoricBlock,
    getValidatorSet
  )
where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Blockstanbul.Messages hiding (sequence)
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Blockstanbul.Options (flags_strictBlockstanbul)
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Lens as L
import Control.Monad (unless)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Except
import Data.Either.Extra
import Data.List
import Data.Maybe (fromJust, fromMaybe)
import Data.Set (Set)
import qualified Data.Set as S
import Text.Printf
import Text.Format

proposerSeal :: HasVault m => Block -> m (Signature)
proposerSeal blk =
  let mesg = proposalMessage blk
   in sign mesg

commitmentSeal :: (HasVault m) => Keccak256 -> m (Signature)
commitmentSeal sha =
  let mesg = commitmentMessage sha
   in sign mesg

signMessage :: (StateMachineM m) => TrustedMessage -> m (OutEvent)
signMessage tm = do
  let mesg = getHash tm
  addr <- use selfAddr
  sig <- sign mesg
  return $ OMsg (MsgAuth (fromJust addr) sig) $ tm

blockstanbulError :: (MonadError String m) => String -> m a
blockstanbulError = if flags_strictBlockstanbul then error else throwError

authenticate :: (A.Selectable Address X509CertInfoState m) => InEvent -> m Bool
authenticate (IMsg (MsgAuth cm sig) tm) = do
  let msgHash = getHash tm
      mKey = recoverPub sig msgHash --recover pub key
      mAddress = fromPublicKey <$> mKey --getting the address of sender
  return (mAddress == Just cm)
authenticate _ = return True

replayHistoricBlock :: (MonadLogger m, MonadError String m) =>
                       Set Validator -> Word256 -> Block -> m (Word256, Validator)
replayHistoricBlock realValidators seqNo blk = do
  IstanbulExtra {..} <- liftEither $ maybeToEither "no istanbul metadata" $ evalIstanbulExtra id blk
  let mProp = verifyProposerSeal blk =<< _proposedSig
      blockNo = fromIntegral . number . blockBlockData $ blk

  signers <- sequence $ map (verifyCommitmentSeal (blockHash blk)) _commitment
      
  let signerRes = S.fromList $ map Validator signers
  
  unless (seqNo + 1 == blockNo) $
    throwError $ printf "unexpected block number: have %d, wanted %d" blockNo (seqNo + 1)

  prop <- liftEither $ maybeToEither "invalid proposer seal" mProp

  let propValidator = Validator prop

  unless (propValidator `elem` realValidators) $
    blockstanbulError $
      "proposer " ++ formatAddressWithoutColor prop ++ " (" ++ format propValidator ++ ")  not a validator"
      ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)

  let expectedValidatorList = S.fromList _validatorList

  unless (expectedValidatorList == realValidators) $
    blockstanbulError $
      "real validator list doesn't match expected validator list for block #" ++ show (number . blockBlockData $ blk)
      ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)
      ++ "\nblock validator list: " ++ show (map format $ S.toList expectedValidatorList)
        
  unless (signerRes `S.isSubsetOf` realValidators) $ do
        let unexplained = intercalate "," . map format . S.toList $ signerRes S.\\ realValidators
        blockstanbulError $
               "unknown signers in block #" ++ show blockNo ++ ": " ++ unexplained
               ++ "\nsignerRes: " ++ show (map format $ S.toList signerRes)
               ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)
               ++ "\nblock validator list: " ++ show (map format $ S.toList expectedValidatorList)

  unless (3 * S.size signerRes > 2 * S.size realValidators) $
    blockstanbulError $
      printf "not enough commit seals (have %d out of %d)" (S.size signerRes) (S.size realValidators)
      ++ ": signerRes = " ++ show signerRes
      ++ ", realValidators = " ++ show realValidators
        
  return (fromIntegral $ seqNo + 1, propValidator)

isHistoricBlock :: Block -> Bool
isHistoricBlock = fromMaybe False . evalIstanbulExtra (fmap $ not . null . _commitment) -- check if signatures list from IstanbulExtra is empty
