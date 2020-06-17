--{-# LANGUAGE OverloadedStrings #-}
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
  ) where



import           Control.DeepSeq
import           Control.Monad
import           Crypto.Random.Entropy
import qualified Crypto.Secp256k1           as S

import           Data.Binary
import           Data.ByteString
import qualified Data.ByteString.Short      as BSS
import           Data.Coerce
import           Data.Data
import           Data.Maybe
import           GHC.Generics
import           Test.QuickCheck

import           Blockchain.Data.RLP
--import           Blockchain.MiscJSON ()
--import           Blockchain.MiscArbitrary ()




-- This module is a wrapper for Crypto.Secp256k1, with
-- all the extra instances we need
-- Use this instead of secp256k1 where possible


------------------------------------------------------
-------------- THE NEWTYPE WRAPPERS ------------------
------------------------------------------------------

newtype PublicKey = PublicKey S.PubKey deriving (Show)
newtype PrivateKey = PrivateKey S.SecKey deriving (Show)
newtype Signature = Signature S.CompactRecSig 
  deriving          (Eq, Show, Generic)
  deriving newtype  (NFData)


------------------------------------------------------
------------------- SIGNATURES -----------------------
------------------------------------------------------

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
    r' <- replicateM 4 (arbitrary :: Gen Word8)
    s' <- replicateM 4 (arbitrary :: Gen Word8)
    v <- arbitrary :: Gen Word8
    
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
  rlpDecode x = error $ "rlpDecode for RecSig failed on " ++ (show x)



recoverPub :: Signature -> ByteString -> Maybe PublicKey
recoverPub (Signature s) msgHash = do
  let sig = fromMaybe (error "could not import recsig") (S.importCompactRecSig s)
      mesg = fromMaybe (error "could not import msgHash") (S.msg msgHash)
  coerce <$> (S.recover sig mesg)


signMsg :: PrivateKey -> ByteString -> Signature
signMsg pk msgHash = do
  let mesg = fromMaybe (error "could not import msgHash") (S.msg msgHash)
      sig' = S.signRecMsg (coerce pk) mesg
  Signature $ S.exportCompactRecSig sig'



------------------------------------------------------
---------------------- KEYS --------------------------
------------------------------------------------------

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
