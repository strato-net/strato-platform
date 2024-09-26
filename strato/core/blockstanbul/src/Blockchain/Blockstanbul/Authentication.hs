{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Blockstanbul.Authentication
  ( module Blockchain.Blockstanbul.Authentication,
    module Blockchain.Blockstanbul.Model.Authentication,
  )
where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Blockstanbul.Messages hiding (sequence)
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Blockstanbul.Options (flags_strictBlockstanbul)
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Lens as L
import Control.Monad (unless)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Except
import Data.Binary
import qualified Data.ByteString.Lazy as BL
import Data.Either.Extra
import Data.List
import Data.Maybe (catMaybes, fromJust, fromMaybe)
import Data.Set (Set)
import qualified Data.Text as T
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

signBenfInfo :: (HasVault m) => (Validator, Bool, Int) -> m (Signature)
signBenfInfo bnf =
  let mesg = keccak256ToByteString $ hash $ BL.toStrict $ encode bnf
   in sign mesg

signMessage :: (StateMachineM m) => TrustedMessage -> m (OutEvent)
signMessage tm = do
  let mesg = getHash tm
  addr <- use selfCert
  sig <- sign mesg
  return $ OMsg (MsgAuth (fromJust addr) sig) $ tm

blockstanbulError :: (MonadError String m) => String -> m a
blockstanbulError = if flags_strictBlockstanbul then error else throwError

authenticate :: (A.Selectable Address X509CertInfoState m) => InEvent -> m Bool
authenticate (IMsg (MsgAuth cm sig) tm) = do
  let msgHash = getHash tm
      mKey = recoverPub sig msgHash --recover pub key
      mAddress = fromPublicKey <$> mKey --getting the address of sender
  res <- case mAddress of
    Nothing -> error "Nothing"
    Just a -> A.select (A.Proxy @X509CertInfoState) a
  let cmAddress = getAddressFromCM cm =<< res
  return (mAddress == cmAddress)
authenticate _ = return True

getValidatorFromAddress :: (MonadError String m, A.Selectable Address X509CertInfoState m) =>
                           Address -> m (Maybe Validator)
getValidatorFromAddress addr = case addr of
  Address 0x8c945210bbedf90a0c54d0e68357398586c865c3 -> pure . Just $ Validator "dustin-node" -- testnet2 hack
  _ -> fmap (chainMemberParsedSetToValidator . getChainMemberFromX509) <$> getX509FromAddress addr

getValidatorFromAddress' :: (MonadError String m, A.Selectable Address X509CertInfoState m) =>
                       Address -> m Validator
getValidatorFromAddress' address = do
  maybeValidator <- getValidatorFromAddress address

  case maybeValidator of
    Nothing -> throwError $ "Missing address in X509 certificate database: " ++ formatAddressWithoutColor address
    Just v -> return v

replayHistoricBlock :: (MonadLogger m, MonadError String m, A.Selectable Address X509CertInfoState m) =>
                       Set Validator -> Word256 -> Block -> m (Word256, Validator)
replayHistoricBlock realValidators seqNo blk = do
  IstanbulExtra {..} <- liftEither $ maybeToEither "no istanbul metadata" $ evalIstanbulExtra id blk
  let mProp = verifyProposerSeal blk =<< _proposedSig
      blockNo = fromIntegral . number . blockBlockData $ blk

  signers <- sequence $ map (verifyCommitmentSeal (blockHash blk)) _commitment
      
  signerRes <- S.fromList . catMaybes <$> traverse getValidatorFromAddress signers
  
  unless (seqNo + 1 == blockNo) $
    throwError $ printf "unexpected block number: have %d, wanted %d" blockNo (seqNo + 1)

  prop <- liftEither $ maybeToEither "invalid proposer seal" mProp

  propValidator <- getValidatorFromAddress' prop

  unless (propValidator `elem` realValidators) $
    blockstanbulError $
      "proposer " ++ formatAddressWithoutColor prop ++ " (" ++ format propValidator ++ ")  not a validator"
      ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)

  let expectedValidatorList = S.map chainMemberParsedSetToValidator $ unChainMembers _validatorList
--  let expectedValidatorList = [c | CommonName _ _ c _ <- S.toList (unChainMembers _validatorList)]

  unless (expectedValidatorList == realValidators) $
    blockstanbulError $
      "real validator list doesn't match expected validator list for block #" ++ show (number . blockBlockData $ blk)
      ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)
      ++ "\nblock validator list: " ++ show (map format $ S.toList expectedValidatorList)
        
  unless (signerRes `S.isSubsetOf` realValidators) $ do
        let unexplained = intercalate "," . map format . S.toList $ signerRes S.\\ realValidators
        if (signerRes S.\\ realValidators) `S.isSubsetOf` futureValidatorsHack
          then $logErrorS "replayHistoricBlock" . T.pack $ "future validators " ++ show unexplained ++ " jumped the gun, signed block #" ++ show blockNo ++ " before they were authorized to do so.  I'll throw the block away and wait for another validator to send me the properly signed block"
          else blockstanbulError $
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

--Required hack to ignore known bugs in the production chain for now.  This should be removed once we restart the chain, or purge the bad blocks from the network
futureValidatorsHack :: Set Validator
futureValidatorsHack = S.fromList [
  "service-account-io-stratomercata-dsnallapu",
  "service-account-io-stratomercata-chessgm9" -- not only does this suffer from the future validator bug, but it also was a false x509 cert because the case of the commonName was wrong
  ]
