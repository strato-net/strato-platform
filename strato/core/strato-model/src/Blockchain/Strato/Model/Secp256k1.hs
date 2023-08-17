{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Model.Secp256k1
  ( PrivateKey (..),
    PublicKey (..),
    Signature (..),
    SharedKey (..),
    HasVault (..),
    newPrivateKey,
    exportPrivateKey,
    importPrivateKey,
    derivePublicKey,
    exportPublicKey,
    importPublicKey,
    deriveSharedKey,
    recoverPub,
    signMsg,
    verifySig,
    exportSignature,
    importSignature,
    importSignature',
  )
where

-- import qualified Data.ByteString.Conversion       as BSC

import Blockchain.Data.RLP
import Control.DeepSeq
import Control.Monad
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.State.Strict (StateT)
import Crypto.Random.Entropy
import qualified Crypto.Secp256k1 as S
import Data.ASN1.Types
import Data.Aeson
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Short as BSS
import Data.Coerce
import Data.Conduit (ConduitT)
import Data.Data
import Data.Maybe
import Data.Swagger (ToSchema)
import Data.Swagger.Internal.Schema (binarySchema, declareNamedSchema, named)
import qualified Data.Text as T
import GHC.Generics
import qualified LabeledError
import Test.QuickCheck
import qualified Text.Colors as CL
import Text.Format

-- This module is a wrapper for Crypto.Secp256k1, with
-- all the extra instances we need
-- Use this instead of secp256k1 where possible

------------------------------------------------------------------
-------------------- THE NEWTYPE WRAPPERS ------------------------
------------------------------------------------------------------

newtype PublicKey = PublicKey S.PubKey deriving (Show, Eq)

newtype PrivateKey = PrivateKey S.SecKey deriving (Show, Eq)

newtype SharedKey = SharedKey B.ByteString deriving (Show, Eq)

newtype Signature = Signature S.CompactRecSig
  deriving (Show, Eq, Generic)
  deriving newtype (NFData)

-------------------------------------------------------------------
------------------------- TYPECLASSES -----------------------------
-------------------------------------------------------------------

-- This type class allows for the abstraction of common secp256k1 operations
--  in some monad that "has a vault" which stores the private key
--  In prod, this is the vault-wrapper, and we use its servant client
--  In tests, the private key is either in the monad, or a global key
class Monad m => HasVault m where
  sign :: B.ByteString -> m Signature
  getPub :: m PublicKey
  getShared :: PublicKey -> m SharedKey

-- some instances we use elsewhere
instance HasVault m => HasVault (ConduitT i o m) where
  sign = lift . sign
  getPub = lift getPub
  getShared = lift . getShared

instance HasVault m => HasVault (StateT s m) where
  sign = lift . sign
  getPub = lift getPub
  getShared = lift . getShared

-------------------------------------------------------------------
----------------------------- KEYS --------------------------------
-------------------------------------------------------------------

instance Arbitrary PrivateKey where
  arbitrary = do
    k <- replicateM 32 (arbitrary :: Gen Word8)
    return $ fromMaybe (error "could not generate arbitrary private key") (importPrivateKey $ B.pack k)

instance ToJSON PrivateKey where
  toJSON = String . T.pack . C8.unpack . B16.encode . exportPrivateKey

instance FromJSON PrivateKey where
  parseJSON (String str) = maybe err pure $ importPrivateKey $ LabeledError.b16Decode "FromJSON<PrivateKey>" $ C8.pack $ T.unpack str
    where
      err = fail $ "parseJSON for PrivateKey failed to read " ++ T.unpack str
  parseJSON x = fail $ "parseJSON for PrivateKey: expected string, got " ++ show x

instance ASN1Object PrivateKey where
  toASN1 key xs =
    ( Start Sequence :
      IntVal 1 :
      OctetString (exportPrivateKey key) :
      Start (Container Context 0) :
      OID [1, 3, 132, 0, 10] :
      End (Container Context 0) :
      End Sequence :
      xs
    )

  fromASN1 [] = Left "tried to decode an empty ASN1 object?"
  fromASN1
    ( Start Sequence
        : IntVal 1
        : OctetString str
        : Start (Container Context 0)
        : OID [1, 3, 132, 0, 10]
        : End (Container Context 0)
        : End Sequence
        : xs
      ) = case (importPrivateKey str) of
      Nothing -> Left "could not asn1decode privkey"
      Just pk -> Right (pk, xs)
  fromASN1 _ = Left "no ASN1 decoding for this kind of EC private key"

instance ToJSON PublicKey where
  toJSON = String . T.pack . C8.unpack . B16.encode . exportPublicKey False

instance FromJSON PublicKey where
  parseJSON (String str) = maybe err pure $ importPublicKey $ LabeledError.b16Decode "FromJSON<PublicKey>" $ C8.pack $ T.unpack str
    where
      err = fail $ "parseJSON for PublicKey failed to read " ++ T.unpack str
  parseJSON x = fail $ "parseJSON for PublicKey: expected string, got " ++ show x

instance ToSchema PublicKey where
  declareNamedSchema _ = return $ named "PublicKey" binarySchema

instance Format PublicKey where
  format = CL.yellow . C8.unpack . B16.encode . exportPublicKey False

instance ToJSON SharedKey where
  toJSON = String . T.pack . C8.unpack . B16.encode . coerce

instance FromJSON SharedKey where
  parseJSON (String str) = return $ SharedKey $ LabeledError.b16Decode "FromJSON<SharedKey>" $ C8.pack $ T.unpack str
  parseJSON x = fail $ "parseJSON failed for SharedKey: expected string, got " ++ show x

instance ToSchema SharedKey where
  declareNamedSchema _ = return $ named "SharedKey" binarySchema

newPrivateKey :: IO PrivateKey
newPrivateKey = do
  ent <- getEntropy 32
  return $ PrivateKey $ fromMaybe err (S.secKey ent)
  where
    err = error "could not generate new private key"

importPrivateKey :: B.ByteString -> Maybe PrivateKey
importPrivateKey bs = PrivateKey <$> S.secKey bs

exportPrivateKey :: PrivateKey -> B.ByteString
exportPrivateKey = S.getSecKey . coerce

derivePublicKey :: PrivateKey -> PublicKey
derivePublicKey = PublicKey . S.derivePubKey . coerce

exportPublicKey :: Bool -> PublicKey -> B.ByteString
exportPublicKey compress (PublicKey pk) = S.exportPubKey compress pk

importPublicKey :: B.ByteString -> Maybe PublicKey
importPublicKey bs = PublicKey <$> S.importPubKey bs

-- the shared Diffie-Hellman (ECDH) secret for ethereum-encryption
deriveSharedKey :: PrivateKey -> PublicKey -> SharedKey
deriveSharedKey (PrivateKey prv) (PublicKey pub) = SharedKey $ S.ecdh pub prv

------------------------------------------------------------------
------------------------- SIGNATURES -----------------------------
------------------------------------------------------------------

deriving instance Data Signature

deriving instance Data S.CompactRecSig

instance Binary Signature where
  put (Signature s) = do
    put $ S.getCompactRecSigR s
    put $ S.getCompactRecSigS s
    put $ S.getCompactRecSigV s

  get = do
    r <- get :: Get BSS.ShortByteString
    s <- get :: Get BSS.ShortByteString
    v <- get :: Get Word8
    return $ Signature (S.CompactRecSig r s v)

instance Arbitrary Signature where
  arbitrary = do
    r' <- replicateM 32 (arbitrary :: Gen Word8)
    s' <- replicateM 32 (arbitrary :: Gen Word8)
    v <- (choose (0, 1)) :: Gen Word8

    let r = BSS.toShort $ B.pack r'
        s = BSS.toShort $ B.pack s'
    return $ Signature (S.CompactRecSig r s v)

instance RLPSerializable Signature where
  rlpEncode = RLPString . exportSignature

  rlpDecode (RLPString str) = case importSignature str of
    Left err -> error $ "rlpDecode for RecSig failed for: " ++ show err
    Right sig -> sig
  rlpDecode (RLPArray [RLPString r, RLPString s, RLPScalar v]) =
    Signature $ S.CompactRecSig (BSS.toShort r) (BSS.toShort s) v
  rlpDecode x = error $ "rlpDecode for RecSig failed on " ++ show x

instance ToJSON Signature where
  toJSON (Signature (S.CompactRecSig r s v)) =
    object
      [ "r" .= enc r,
        "s" .= enc s,
        "v" .= v
      ]
    where
      enc = T.pack . C8.unpack . B16.encode . BSS.fromShort

instance FromJSON Signature where
  parseJSON (Object o) = do
    r <- o .: "r"
    s <- o .: "s"
    v <- o .: "v"
    return $ Signature $ S.CompactRecSig (dec r) (dec s) v
    where
      dec = BSS.toShort . LabeledError.b16Decode "FromJSON<Signature>" . C8.pack . T.unpack
  parseJSON o = fail $ "parseJSON Signature failed: expected object, got: " ++ show o

instance ToSchema Signature where
  declareNamedSchema _ = return $ named "Signature" binarySchema

-- NOTE: secp256k1-haskell, in its infinite wisdom, has swapped the R and S
-- values in the signatures it generates...this is verified against the signatures
-- we use (and will soon phase out) in ExtendedECDSA
-- I'm not the first to notice this: https://github.com/haskoin/secp256k1-haskell/issues/12
--
-- This wouldn't be a problem if we didn't need to do anything with the R and S
-- values themselves, but we do....we put them directly into Transactions, and
-- pull them out when we want to do public key recovery.
-- To maintain backwards compatibility, we need to swap R and S back to their
-- correct positions...otherwise, if we tried to do recovery on old transactions,
-- we'd get the wrong address.
--
-- So, the signature and recovery functions below swap the R and S values, so that
-- every other part of the platform can just assume that they are right
--
-- Oh, and in Ethereum, transaction signatures use either 27 or 28 for the V value,
-- but secp256k1-haskell (and RLPx) uses 0 and 1 (and VERY rarely, 2 and 3). So, to be
-- backwards compatible, we have to add 27 (0x1b) to the sigV value for all TX sigs.
-- We do this in Bloc, and then subtract 27 to do pubkey recovery in seqevents, so
-- we can keep the sigVs normal here.

recoverPub :: Signature -> B.ByteString -> Maybe PublicKey
recoverPub (Signature (S.CompactRecSig r s v)) msgHash =
  let sig' = S.CompactRecSig s r v -- the swapped sig
      sig = fromMaybe (error "could not import recsig") (S.importCompactRecSig sig')
      mesg = fromMaybe (error "could not import msgHash") (S.msg msgHash)
   in PublicKey <$> (S.recover sig mesg)

signMsg :: PrivateKey -> B.ByteString -> Signature
signMsg pk msgHash =
  let mesg = fromMaybe (error "msg is not 32 bytes") (S.msg msgHash)
      (S.CompactRecSig r s v) = S.exportCompactRecSig $ S.signRecMsg (coerce pk) mesg
   in Signature $ S.CompactRecSig s r v -- the swapped sig

verifySig :: PublicKey -> Signature -> B.ByteString -> Bool
verifySig pk (Signature csig) msgHash =
  let mesg = fromMaybe (error "msg is not 32 bytes") (S.msg msgHash)
      sig = S.convertRecSig $ fromMaybe (error "compact recsig -> recsig failed") (S.importCompactRecSig csig)
   in S.verifySig (coerce pk) sig mesg

exportSignature :: Signature -> B.ByteString
exportSignature (Signature (S.CompactRecSig r s v)) = BSS.fromShort r <> BSS.fromShort s <> B.singleton v

importSignature :: B.ByteString -> Either String Signature
importSignature bs | B.length bs /= 65 = Left $ "importSignature called with incorrect number of bytes: " ++ (show $ B.length bs) ++ ", expected 65"
importSignature bs =
  let r = B.take 32 bs
      s = B.take 32 $ B.drop 32 bs
      v = B.head $ B.drop 64 bs
   in Right $ Signature $ S.CompactRecSig (BSS.toShort r) (BSS.toShort s) v

-- Import a DER encoded EC Signature into a Compact Recoverable Signature
-- Since the recovery bit is lost when stored in an X.509 Certificate, the V bit is made up
-- To comply with the type structure
importSignature' :: B.ByteString -> Maybe Signature
importSignature' bs =
  case S.importSig bs of
    Nothing -> Nothing
    Just sig ->
      let (S.CompactSig r s) = S.exportCompactSig sig
       in Just $ Signature (S.CompactRecSig r s (1 :: Word8))
