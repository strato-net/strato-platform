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

import BlockApps.X509.Certificate
import Blockchain.Blockstanbul.Messages hiding (sequence)
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Applicative ((<|>))
import Control.Lens as L
import Control.Monad (liftM2, liftM3, unless)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Except
import Data.Binary
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Either.Extra
import Data.List
import Data.Maybe (catMaybes, fromJust, isJust)
import Data.Set (Set)
import qualified Data.Set as S
import Test.QuickCheck
import Text.Printf
import Text.Format

instance Arbitrary IstanbulExtra where
  arbitrary = liftM3 IstanbulExtra arbitrary arbitrary arbitrary

instance Arbitrary ExtraData where
  arbitrary = liftM2 ExtraData arbitrary arbitrary

getValidatorSet :: HasIstanbulExtra h => h -> Set Validator
getValidatorSet =  evalIstanbulExtra (maybe S.empty $ S.map chainMemberParsedSetToValidator . unChainMembers . _validatorList)

addValidators :: HasIstanbulExtra h => ChainMembers -> h -> h
addValidators vs = execIstanbulExtra (const . Just $ IstanbulExtra vs Nothing [])

getProposerSeal :: HasIstanbulExtra h => h -> Maybe Signature
getProposerSeal = evalIstanbulExtra (_proposedSig =<<)

addProposerSeal :: HasIstanbulExtra h => Signature -> h -> h
addProposerSeal sig = execIstanbulExtra addSeal
  where addSeal i = fmap (set proposedSig (Just sig)) i
                <|> error "must set validators before proposer seal"

addCommitmentSeals :: HasIstanbulExtra h => [Signature] -> h -> h
addCommitmentSeals sigs = execIstanbulExtra addSeals
  where addSeals i = fmap (set commitment sigs) i
                 <|> error "must set validators before commitment seals"

scrubAllSeals :: Maybe IstanbulExtra -> Maybe IstanbulExtra
scrubAllSeals = set (_Just . proposedSig) Nothing
              . set (_Just . commitment) []

scrubSignaturesFromBlock :: [Signature] -> [Signature]
scrubSignaturesFromBlock _ = []

proposalMessage :: Block -> B.ByteString
proposalMessage =
  keccak256ToByteString
    . hash
    . rlpSerialize
    . rlpEncode
    . execIstanbulExtra scrubAllSeals
    . blockBlockData

proposerSeal :: HasVault m => Block -> m (Signature)
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

verifyCommitmentSeal :: MonadError String m =>
                        Keccak256 -> Signature -> m Address
verifyCommitmentSeal sha sig =
  let mesg = commitmentMessage sha
   in fromPublicKey <$> recoverPub' sig mesg

recoverPub' :: MonadError String m =>
               Signature -> ByteString -> m PublicKey
recoverPub' sig v =
  case recoverPub sig v of
    Nothing -> throwError "can't recover public key"
    Just val -> return val

signBenfInfo :: (HasVault m) => (Validator, Bool, Int) -> m (Signature)
signBenfInfo bnf =
  let mesg = keccak256ToByteString $ hash $ BL.toStrict $ encode bnf
   in sign mesg

verifyBenfInfo :: (Validator, Bool, Int) -> Signature -> Maybe Address
verifyBenfInfo bnf sig =
  let mesg = keccak256ToByteString $ hash $ BL.toStrict $ encode (bnf)
   in fromPublicKey <$> recoverPub sig mesg

signMessage :: (StateMachineM m) => TrustedMessage -> m (OutEvent)
signMessage tm = do
  let mesg = getHash tm
  addr <- use selfCert
  sig <- sign mesg
  return $ OMsg (MsgAuth (fromJust addr) sig) $ tm

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


getX509FromAddress' :: (MonadError String m, A.Selectable Address X509CertInfoState m) =>
                       Address -> m X509CertInfoState
getX509FromAddress' address = do
  maybeCert <- getX509FromAddress address

  case maybeCert of
    Nothing -> throwError $ "Missing address in X509 certificate database: " ++ formatAddressWithoutColor address
    Just v -> return v

replayHistoricBlock :: (MonadError String m, A.Selectable Address X509CertInfoState m) =>
                       Set Validator -> Word256 -> Block -> m (Word256, Validator)
replayHistoricBlock realValidators seqNo blk = do
  IstanbulExtra {..} <- liftEither $ maybeToEither "no istanbul metadata" $ evalIstanbulExtra id blk
  let mProp = verifyProposerSeal blk =<< _proposedSig
      blockNo = fromIntegral . number . blockBlockData $ blk

  signers <- sequence $ map (verifyCommitmentSeal (blockHash blk)) _commitment
      
  noAddress <- sequence $ map getX509FromAddress signers
  
  let signerRes = S.fromList $ ((chainMemberParsedSetToValidator . getChainMemberFromX509) <$> (catMaybes noAddress))
  
  unless (seqNo + 1 == blockNo) $
    throwError $ printf "unexpected block number: have %d, wanted %d" blockNo (seqNo + 1)

  prop <- liftEither $ maybeToEither "invalid proposer seal" mProp

  propCert <- getX509FromAddress' prop

  let propChainMember = chainMemberParsedSetToValidator $ getChainMemberFromX509 propCert

  unless (propChainMember `elem` realValidators) $
    throwError $
--    error $
      "proposer " ++ formatAddressWithoutColor prop ++ " (" ++ format propChainMember ++ ")  not a validator"
      ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)

  let expectedValidatorList = S.map chainMemberParsedSetToValidator $ unChainMembers _validatorList
--  let expectedValidatorList = [c | CommonName _ _ c _ <- S.toList (unChainMembers _validatorList)]

  unless (expectedValidatorList == realValidators) $
    throwError $
      "real validator list doesn't match expected validator list for block #" ++ show (number . blockBlockData $ blk)
      ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)
      ++ "\nblock validator list: " ++ show (map format $ S.toList expectedValidatorList)
        
  unless (signerRes `S.isSubsetOf` realValidators) $ do
        let unexplained = intercalate "," . map format . S.toList $ signerRes S.\\ realValidators
        if (signerRes S.\\ realValidators) `S.isSubsetOf` futureValidatorsHack
          then throwError $ "future validators " ++ show unexplained ++ " jumped the gun, signed block #" ++ show blockNo ++ " before they were authorized to do so.  I'll throw the block away and wait for another validator to send me the properly signed block"
          else throwError $
               "unknown signers in block #" ++ show blockNo ++ ": " ++ unexplained
               ++ "\nsignerRes: " ++ show (map format $ S.toList signerRes)
               ++ "\nreal validator list: " ++ show (map format $ S.toList realValidators)
               ++ "\nblock validator list: " ++ show (map format $ S.toList expectedValidatorList)

  unless (3 * S.size signerRes > 2 * S.size realValidators) $
    throwError $
--        error $ --will make this stricter once the full soln is in
      printf "not enough commit seals (have %d out of %d)" (S.size signerRes) (S.size realValidators)
      ++ ": signerRes = " ++ show signerRes
      ++ ", realValidators = " ++ show realValidators
        
  return (fromIntegral $ seqNo + 1, propChainMember)

isHistoricBlock :: Block -> Bool
isHistoricBlock = evalIstanbulExtra isJust

--Required hack to ignore known bugs in the production chain for now.  This should be removed once we restart the chain, or purge the bad blocks from the network
futureValidatorsHack :: Set Validator
futureValidatorsHack = S.fromList [
  "service-account-io-stratomercata-dsnallapu",
  "service-account-io-stratomercata-chessgm9" -- not only does this suffer from the future validator bug, but it also was a false x509 cert because the case of the commonName was wrong
  ]
