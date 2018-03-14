{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE KindSignatures      #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Data.Word.Util
(
  Word256
, Word160
, Word128

-- Data types
, BigNum(..)
, BigWord(..)
) where

import GHC.TypeLits
import Test.QuickCheck
    ( Arbitrary
    , arbitrary
    , arbitrarySizedBoundedIntegral
    )

import Control.Monad (unless, guard, mzero, (<=<))

import Data.Bits (Bits(..), FiniteBits(..))
import Data.Binary (Binary, get, put)
import Data.Binary.Get
    ( getWord64be
    , getWord32be
    , getWord8
    , getByteString
    , Get
    )
import Data.Binary.Put
    ( putWord64be
    , putWord32be
    , putWord8
    , putByteString
    )
import Data.Aeson
    ( Value (String)
    , FromJSON
    , ToJSON
    , parseJSON
    , toJSON
    , withText
    )
import qualified Data.ByteString as BS (head, length, reverse)
import           Data.Proxy
import qualified Data.Text as T (pack, unpack)

newtype BigNum s (n :: Nat) = BigNum { getBigNumInteger :: Integer }
  deriving (Eq, Ord, Read, Show)

data Unsigned
data Signed

type BigWord n = BigNum Unsigned n
type BigInt n = BigNum Signed n

reify :: forall n. (KnownNat n) => Proxy ('BigNum _ n) -> Int
reify _ = natVal $ Proxy :: Proxy n

instance Num (BigNum Unsigned n) where
    fromInteger i = BigNum $ i `mod` (2 ^ n)
    (BigNum i1) + (BigNum i2) = fromInteger $ i1 + i2
    (BigNum i1) * (BigNum i2) = fromInteger $ i1 * i2
    negate = id
    abs = id
    signum _ = BigNum 1

instance Num (BigNum Signed n) where
    fromInteger i = BigNum $ ((i + e) `mod` (2 * e)) - e
      where e = (2 ^ (n - 1))
    (BigNum i1) + (BigNum i2) = fromInteger $ i1 + i2
    (BigNum i1) * (BigNum i2) = fromInteger $ i1 * i2
    negate (BigNum i) = BigNum $ negate i
    abs (BigNum i) = BigNum $ if i < 0 then negate i else i
    signum (BigNum i) = BigNum $ if i < 0 then -1 else 1

instance Bits (BigNum s n) where
    (BigNum i1) .&. (BigNum i2) = fromInteger $ i1 .&. i2
    (BigNum i1) .|. (BigNum i2) = fromInteger $ i1 .|. i2
    (BigNum i1) `xor` (BigNum i2) = fromInteger $ i1 `xor` i2
    complement (BigNum i) = fromInteger $ complement i
    bitSizeMaybe = Just n
    bitSize = n
    shift (BigNum i) j = fromInteger $ shift i j
    testBit (BigNum i) = testBit i
    bit b = fromInteger $ bit b
    popCount (BigNum i) = popCount i
    isSigned _ = False
    rotate x i = shift x i' .|. shift x (i' - n)
      where
        i' = i `mod` n

instance FiniteBits (BigNum s n) where
    finiteBitSize = n

instance Bounded (BigNum Unsigned n) where
    minBound = fromInteger 0
    maxBound = fromInteger ((2 ^ n) - 1)

instance Bounded (BigNum Signed n) where
    minBound = fromInteger (2 ^ (n - 1))
    maxBound = fromInteger ((2 ^ (n - 1)) - 1)

instance Real (BigNum s n) where
    toRational (BigNum i) = toRational $ fromInteger i

instance Enum (BigNum s n) where
    succ r@(BigNum i)
        | (fromInteger r) == maxBound = error "BigNum: tried to take succ of maxBound"
        | otherwise = fromInteger $ succ i
    pred r@(BigNum i)
        | (fromInteger r) == minBound = error "BigNum: tried to take pred of minBound"
        | otherwise = fromInteger $ pred i
    toEnum i
        | toInteger i >= toInteger (minFrom r) &&
          toInteger i <= toInteger (maxFrom r) = r
        | otherwise = error "BigNum: toEnum is outside of bounds"
      where
        r = fromInteger $ toEnum i
        minFrom :: BigNum s n -> BigNum s n
        minFrom _ = minBound
        maxFrom :: BigNum s n -> BigNum s n
        maxFrom _ = maxBound
    fromEnum (BigNum i) = fromEnum i

instance Integral (BigNum s n) where
    (BigNum i1) `quot` (BigNum i2) = fromInteger $ i1 `quot` i2
    (BigNum i1) `rem` (BigNum i2) = fromInteger $ i1 `rem` i2
    (BigNum i1) `div` (BigNum i2) = fromInteger $ i1 `div` i2
    (BigNum i1) `mod` (BigNum i2) = fromInteger $ i1 `mod` i2
    (BigNum i1) `quotRem` (BigNum i2) = (fromInteger a, fromInteger b)
      where
        (a,b) = i1 `quotRem` i2
    (BigNum i1) `divMod` (BigNum i2) = (fromInteger a, fromInteger b)
      where
        (a,b) = i1 `divMod` i2
    toInteger (BigNum i) = i

{- Binary instances for serialization / deserialization -}

instance Binary (BigNum Unsigned 256) where
    get = do
        a <- fromIntegral <$> getWord64be
        b <- fromIntegral <$> getWord64be
        c <- fromIntegral <$> getWord64be
        d <- fromIntegral <$> getWord64be
        return $ (a `shiftL` 192) + (b `shiftL` 128) + (c `shiftL` 64) + d

    put (BigNum i) = do
        putWord64be $ fromIntegral (i `shiftR` 192)
        putWord64be $ fromIntegral (i `shiftR` 128)
        putWord64be $ fromIntegral (i `shiftR` 64)
        putWord64be $ fromIntegral i

instance Binary (BigNum Signed 256) where
    get = do
        a <- fromIntegral <$> getWord64be
        b <- fromIntegral <$> getWord64be
        c <- fromIntegral <$> getWord64be
        d <- fromIntegral <$> getWord64be
        return . fromInteger $ (a `shiftL` 192) + (b `shiftL` 128) + (c `shiftL` 64) + d

    put (BigNum i) = do
        if i < 0
          then putWord64be $ fromIntegral $ ((1 `shiftL` 63) .|. i) `shiftR` 192
          else putWord64be $ fromIntegral $ (i `shiftR` 192)
        putWord64be $ fromIntegral (i `shiftR` 128)
        putWord64be $ fromIntegral (i `shiftR` 64)
        putWord64be $ fromIntegral i

instance Binary (BigNum Unsigned 160) where
    get = do
        a <- fromIntegral <$> getWord32be
        b <- fromIntegral <$> getWord64be
        c <- fromIntegral <$> getWord64be
        return $ (a `shiftL` 128) + (b `shiftL` 64) + c

    put (BigNum i) = do
        putWord32be $ fromIntegral (i `shiftR` 128)
        putWord64be $ fromIntegral (i `shiftR` 64)
        putWord64be $ fromIntegral i

instance Binary (BigNum Signed 160) where
    get = do
        a <- fromIntegral <$> getWord32be
        b <- fromIntegral <$> getWord64be
        c <- fromIntegral <$> getWord64be
        return $ (a `shiftL` 128) + (b `shiftL` 64) + c

    put (BigNum i) = do
        if i < 0
          then putWord32be $ fromIntegral $ ((1 `shiftL` 31) .|. i) `shiftR` 128
          else putWord32be $ fromIntegral $ (i `shiftR` 128)
        putWord64be $ fromIntegral (i `shiftR` 64)
        putWord64be $ fromIntegral i

instance Binary (BigNum Unsigned 128) where
    get = do
        a <- fromIntegral <$> getWord64be
        b <- fromIntegral <$> getWord64be
        return $ (a `shiftL` 64) + b

    put (BigNum i) = do
        putWord64be $ fromIntegral (i `shiftR` 64)
        putWord64be $ fromIntegral i

instance Binary (BigNum Signed 128) where
    get = do
        a <- fromIntegral <$> getWord64be
        b <- fromIntegral <$> getWord64be
        return $ (a `shiftL` 64) + b

    put (BigNum i) = do
        if i < 0
          then putWord64be $ fromIntegral $ ((1 `shiftL` 63) .|. i) `shiftR` 64
          else putWord64be $ fromIntegral $ (i `shiftR` 64)
        putWord64be $ fromIntegral i

instance ToJSON (BigNum Unsigned 256) where
    toJSON = String . T.pack . bsToHex . encode'

instance FromJSON (BigNum Unsigned 256) where
    parseJSON = withText "Word256" $
        maybe mzero return . (decodeToMaybe <=< hexToBS) . T.unpack

instance Arbitrary (BigNum Unsigned n) where
    arbitrary = arbitrarySizedBoundedIntegral

instance Arbitrary (BigNum Signed n) where
    arbitrary = arbitrarySizedBoundedIntegral
