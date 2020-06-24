{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE StandaloneDeriving #-}
--{-# LANGUAGE DerivingStrategies #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.ECDSA
  ( Signature(..) 
  , PublicKey(..)
  , PrivateKey(..)
  , recoverPub
  , signMsg
  , newPrivateKey
  , readPrivateKey
  , derivePublicKey
  , exportPublicKey
  , importPublicKey
  ) where



import           Control.DeepSeq
import           Control.Monad
import           Crypto.Random.Entropy
import qualified Crypto.Secp256k1               as S

import           Data.Aeson
import           Data.Binary                
import           Data.ByteString                as B
import qualified Data.ByteString.Base16         as B16
import qualified Data.ByteString.Char8          as C8
import qualified Data.ByteString.Short          as BSS
import           Data.Coerce
import           Data.Data
import           Data.Maybe
import qualified Data.Text                      as T
import           Data.Swagger                   (ToSchema)
import           Data.Swagger.Internal.Schema   (named, declareNamedSchema, binarySchema)
import           GHC.Generics
import           Test.QuickCheck

import           Blockchain.Data.RLP



-- This module is a wrapper for Crypto.Secp256k1, with
-- all the extra instances we need
-- Use this instead of secp256k1 where possible


------------------------------------------------------------------
-------------------- THE NEWTYPE WRAPPERS ------------------------
------------------------------------------------------------------

newtype PublicKey = PublicKey S.PubKey deriving (Show, Eq)
newtype PrivateKey = PrivateKey S.SecKey deriving (Show, Eq)
newtype Signature = Signature S.CompactRecSig 
  deriving          (Show, Eq, Generic)
  deriving newtype  (NFData)


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
    v <- (choose (27,28)) :: Gen Word8
    
    let r = BSS.toShort $ pack r'
        s = BSS.toShort $ pack s'
    return $ Signature (S.CompactRecSig r s v)


instance RLPSerializable Signature where
  rlpEncode (Signature sig) = RLPArray [ RLPString r
                                       , RLPString s
                                       , RLPScalar v 
                                       ]
      where
        r = BSS.fromShort $ S.getCompactRecSigR sig
        s = BSS.fromShort $ S.getCompactRecSigS sig
        v = S.getCompactRecSigV sig
  
  rlpDecode (RLPArray [RLPString r, RLPString s, RLPScalar v]) = 
      Signature $ S.CompactRecSig (BSS.toShort r) (BSS.toShort s) v
  rlpDecode x = error $ "rlpDecode for RecSig failed on " ++ show x


instance ToJSON Signature where
  toJSON (Signature (S.CompactRecSig r s v)) = 
      object [ "r" .= enc r
             , "s" .= enc s
             , "v" .= v
             ]
        where enc = T.pack . C8.unpack . B16.encode . BSS.fromShort

instance FromJSON Signature where
  parseJSON (Object o) = do
    r <- o .: "r"
    s <- o .: "s"
    v <- o .: "v"
    return $ Signature $ S.CompactRecSig (dec r) (dec s) v
      where dec = BSS.toShort . fst . B16.decode . C8.pack . T.unpack
  parseJSON o = error $ "parseJSON Signature failed: expected object, got: " ++ show o

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
-- Oh, and we have to add/subtract 0x1b to V ...Ethereum uses either 27 or 28 for this
-- value, but secp256k1-haskell uses 0 and 1 (VERY rarely, 3 and 4). So to be backwards 
-- compatible, we have to add 27. The Signature arbitrary instance chooses 27 or 28

recoverPub :: Signature -> ByteString -> Maybe PublicKey
recoverPub (Signature (S.CompactRecSig r s v)) msgHash =
  let sig' = S.CompactRecSig s r (v - 0x1b)  -- the swapped sig
      sig = fromMaybe (error "could not import recsig") (S.importCompactRecSig sig')
      mesg = fromMaybe (error "could not import msgHash") (S.msg msgHash)
  in PublicKey <$> (S.recover sig mesg)


signMsg :: PrivateKey -> ByteString -> Signature
signMsg pk msgHash = 
  let mesg = fromMaybe (error "could not import msgHash") (S.msg msgHash)
      (S.CompactRecSig r s v) = S.exportCompactRecSig $ S.signRecMsg (coerce pk) mesg
  in Signature $ S.CompactRecSig s r (0x1b + v) -- the swapped sig



-------------------------------------------------------------------
----------------------------- KEYS --------------------------------
-------------------------------------------------------------------


instance ToJSON PublicKey where
  toJSON = String . T.pack . C8.unpack . B16.encode . exportPublicKey False

instance FromJSON PublicKey where
  parseJSON (String str) = return $ fromMaybe (err) $ importPublicKey $ fst $ B16.decode $ C8.pack $ T.unpack str
    where err = error $ "parseJSON for PublicKey failed to read " ++ T.unpack str
  parseJSON x = error $ "parseJSON for PublicKey: expected string, got " ++ show x

instance ToSchema PublicKey where
  declareNamedSchema _ = return $ named "PublicKey" binarySchema



newPrivateKey :: IO PrivateKey
newPrivateKey = do
  ent <- getEntropy 32
  return $ PrivateKey $ fromMaybe err (S.secKey ent)
  where
    err = error "could not generate new private key"

readPrivateKey :: ByteString -> PrivateKey
readPrivateKey bs = PrivateKey $ fromMaybe err (S.secKey bs)
  where
    err = error "could not make private key from bytestring"

derivePublicKey :: PrivateKey -> PublicKey
derivePublicKey = PublicKey . S.derivePubKey . coerce

exportPublicKey :: Bool -> PublicKey -> ByteString
exportPublicKey compress (PublicKey pk) = S.exportPubKey compress pk

importPublicKey :: ByteString -> Maybe PublicKey
importPublicKey bs = PublicKey <$> S.importPubKey bs
