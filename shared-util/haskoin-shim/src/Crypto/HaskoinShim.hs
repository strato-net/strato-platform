{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE TypeApplications #-}
-- This is a layer over blockapps-haskoin with the interface
-- of secp256k1-haskell
module Crypto.HaskoinShim
  ( PubKey(..)
  , SecKey(..)
  , Msg
  , exportPubKey
  , importPubKey
  , derivePubKey
  ) where

import qualified Data.ByteString           as B
import qualified Data.ByteString.Lazy      as BL
import           Data.Binary
import           Data.Coerce
import           Test.QuickCheck

import           Blockchain.Strato.Model.ExtendedWord
import qualified Network.Haskoin.Crypto    as HK
import qualified Network.Haskoin.Internals as HK

import           Blockchain.ExtendedECDSA


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

-- Type conversions

importPubKey :: B.ByteString -> Maybe PubKey
importPubKey = either (const Nothing) (\(_, _, x) -> Just $ PubKey x) . decodeOrFail . BL.fromStrict

changeCompression :: Bool -> PubKey -> PubKey
changeCompression compress = coerce . HK.makePubKeyG compress . HK.pubKeyPoint . coerce

exportPubKey :: Bool -> PubKey -> B.ByteString
exportPubKey compressed = BL.toStrict . either encode encode . HK.eitherPubKey . coerce . changeCompression compressed

-- Crypto

derivePubKey :: SecKey -> PubKey
derivePubKey = coerce . HK.derivePubKey . coerce

-- Misc
instance Arbitrary PubKey where
  arbitrary = derivePubKey <$> arbitrary
