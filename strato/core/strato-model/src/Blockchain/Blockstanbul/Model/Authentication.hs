{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Blockstanbul.Model.Authentication where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address

import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Applicative ((<|>))
import Control.Arrow ((&&&))
import Control.Lens
import Control.Monad (liftM2, liftM3)
import Control.Monad.Except
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.ByteString (ByteString)
import Data.Set (Set)
import qualified Data.Set as S
import Test.QuickCheck
import Test.QuickCheck.Instances.ByteString ()

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

instance Arbitrary IstanbulExtra where
  arbitrary = liftM3 IstanbulExtra arbitrary arbitrary arbitrary

instance Arbitrary ExtraData where
  arbitrary = liftM2 ExtraData arbitrary arbitrary

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

proposalMessage :: (RLPHashable h, HasIstanbulExtra h) => h -> B.ByteString
proposalMessage =
  keccak256ToByteString
    . rlpHash
    . execIstanbulExtra scrubAllSeals

proposalHash :: (RLPHashable h, HasIstanbulExtra h) => h -> Keccak256
proposalHash = rlpHash . execIstanbulExtra scrubAllSeals

verifyProposerSeal :: (RLPHashable h, HasIstanbulExtra h) => h -> Signature -> Maybe Address
verifyProposerSeal h sig =
  let mesg = proposalMessage h
   in fromPublicKey <$> recoverPub sig mesg

commitmentMessage :: Keccak256 -> B.ByteString
commitmentMessage dig = keccak256ToByteString . hash . (<> B.singleton 2) . keccak256ToByteString $ dig

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

verifyBenfInfo :: (Validator, Bool, Int) -> Signature -> Maybe Address
verifyBenfInfo bnf sig =
  let mesg = keccak256ToByteString $ hash $ BL.toStrict $ encode (bnf)
   in fromPublicKey <$> recoverPub sig mesg