{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE TypeApplications #-}
-- This is a layer over blockapps-haskoin with the interface
-- of secp256k1-haskell
module Crypto.HaskoinShim
  ( PubKey(..)
  , SecKey(..)
  , Msg
  , CompactRecSig(..)
  , CompactSig(..)
  , changeCompression
  , exportCompactRecSig
  , exportPubKey
  , importCompactRecSig
  , importCompactSig
  , importPubKey
  , msg
  , getSecKey
  , secKey
  , convertRecSig
  , recover
  , derivePubKey
  , verifySig
  , signRecMsg
  , HK.makePubKey
  , HK.Point(..)
  ) where

import qualified Data.ByteString           as B
import qualified Data.ByteString.Base16    as B16
import qualified Data.ByteString.Lazy      as BL
import qualified Data.ByteString.Char8     as C8
import           Data.Binary
import           Data.Coerce
import qualified Data.Aeson                as Ae
import           Data.Maybe
import qualified Data.Text                 as T
import           Test.QuickCheck

import           Blockchain.Strato.Model.ExtendedWord
import qualified Network.Haskoin.Crypto    as HK
import qualified Network.Haskoin.Internals as HK

import           Blockchain.ExtendedECDSA
import           Blockchain.FastECRecover


-- Interface types

data CompactSig = CompactSig
  { getCompactSigR :: !Word256
  , getCompactSigS :: !Word256
  } deriving (Eq, Show)
data CompactRecSig = CompactRecSig
  { getCompactRecSigR :: !Word256
  , getCompactRecSigS :: !Word256
  , getCompactRecSigV :: !Word8
  } deriving (Eq, Show)

-- Internal types

newtype PubKey = PubKey HK.PubKey deriving (Show)
newtype SecKey = SecKey HK.PrvKey deriving newtype (Eq, Show, Arbitrary)
newtype Msg = Msg Word256 deriving newtype (Eq, Show, Arbitrary)
newtype RecSig = RecSig ExtendedSignature deriving (Eq, Show)
newtype Sig = Sig HK.Signature deriving (Eq, Show)

instance Eq PubKey where
  a == b = HK.pubKeyPoint (coerce a) == HK.pubKeyPoint (coerce b)

instance Ae.ToJSON PubKey where
  toJSON pk = Ae.String $ T.pack $ C8.unpack $ B16.encode $ exportPubKey False pk


instance Ae.FromJSON PubKey where
  parseJSON (Ae.String str) = return $ fromMaybe (err) $ importPubKey $ fst $ B16.decode $ C8.pack $ T.unpack str
    where err = error $ "parseJSON for PubKey failed to read " ++ (T.unpack str)
  parseJSON x = error $ "parseJSON for PubKey: expected string, got " ++ (show x)



--pubkey = drop 2 . C8.unpack . B16.encode . exportPubKey False . derivePubKey $ SecKey prvkey



-- Type conversions

exportCompactRecSig :: RecSig -> CompactRecSig
exportCompactRecSig rc = let ExtendedSignature (HK.Signature r s) y = coerce rc
                         in CompactRecSig (fromIntegral r) (fromIntegral s) (if y then 1 else 0)

importPubKey :: B.ByteString -> Maybe PubKey
importPubKey = either (const Nothing) (\(_, _, x) -> Just $ PubKey x) . decodeOrFail . BL.fromStrict

changeCompression :: Bool -> PubKey -> PubKey
changeCompression compress = coerce . HK.makePubKeyG compress . HK.pubKeyPoint . coerce

exportPubKey :: Bool -> PubKey -> B.ByteString
exportPubKey compressed = BL.toStrict . either encode encode . HK.eitherPubKey . coerce . changeCompression compressed


importCompactSig :: CompactSig -> Maybe Sig
importCompactSig (CompactSig r s) = Just . Sig $ HK.Signature (fromIntegral r) (fromIntegral s)

importCompactRecSig :: CompactRecSig -> Maybe RecSig
importCompactRecSig (CompactRecSig r s v) = RecSig
                                          . ExtendedSignature (HK.Signature (fromIntegral r) (fromIntegral s))
                                        <$> case v of
                                              0 -> return False
                                              1 -> return True
                                              _ -> Nothing

msg :: Word256 -> Maybe Msg
msg = Just . Msg

getSecKey :: SecKey -> B.ByteString
getSecKey = HK.encodePrvKey . coerce

secKey :: B.ByteString -> Maybe SecKey
secKey = coerce . HK.decodePrvKey HK.makePrvKey

convertRecSig :: RecSig -> Sig
convertRecSig (RecSig (ExtendedSignature sig _)) = coerce sig

-- Crypto

derivePubKey :: SecKey -> PubKey
derivePubKey = coerce . HK.derivePubKey . coerce

signRecMsg :: SecKey -> Msg -> RecSig
signRecMsg sec word = coerce $ detExtSignMsg (coerce word) (coerce sec)

verifySig :: PubKey -> Sig -> Msg -> Bool
verifySig pub sig word = HK.verifySig (coerce word) (coerce sig) (coerce pub)

recover :: RecSig -> Msg -> Maybe PubKey
recover rc word = coerce <$> getPubKeyFromSignature_libsecp256k1 (coerce rc) (coerce word)

-- Misc
instance Arbitrary PubKey where
  arbitrary = derivePubKey <$> arbitrary
