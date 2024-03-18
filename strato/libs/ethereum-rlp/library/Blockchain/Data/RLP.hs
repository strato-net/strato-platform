{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}

-- | The RLP module provides a framework within which serializers can be built, described in the Ethereum Yellowpaper (<http://gavwood.com/paper.pdf>).
--
-- The 'RLPObject' is an intermediate data container, whose serialization rules are well defined.  By creating code that converts from a
-- given type to an 'RLPObject', full serialization will be specified.  The 'RLPSerializable' class provides functions to do this conversion.
module Blockchain.Data.RLP
  ( RLPObject (..),
    RLPSerializable (..),
    RLPSerializable1 (..),
    rlpDecode1,
    rlpEncode1,
    rlpSplit,
    rlpSplitMaybe,
    rlpSplitEither,
    rlpSerialize,
    rlpDeserialize,
    rlpDeserializeMaybe,
    rlpDeserializeEither,
    int2Bytes,
  )
where

import Blockchain.Data.Util
import Control.DeepSeq
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.ByteString.Internal
import Data.Fix
import Data.Functor.Compose
import Data.Functor.Identity
import Data.List
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import Data.Word
import GHC.Generics
import Numeric
import Text.Format

-- | An internal representation of generic data, with no type information.
--
-- End users will not need to directly create objects of this type (an 'RLPObject' can be created using 'rlpEncode'),
-- however the designer of a new type will need to create conversion code by making their type an instance
-- of the RLPSerializable class.
data RLPObject = RLPScalar Word8 | RLPString B.ByteString | RLPArray [RLPObject] deriving (Show, Eq, Ord, Generic)

instance NFData RLPObject

-- | Converts objects to and from 'RLPObject's.
class RLPSerializable a where
  rlpDecode :: RLPObject -> a
  rlpEncode :: a -> RLPObject

class RLPSerializable1 f where
  liftRlpDecode :: (RLPObject -> a) -> RLPObject -> f a
  liftRlpEncode :: (a -> RLPObject) -> f a -> RLPObject

rlpDecode1 :: (RLPSerializable1 f, RLPSerializable a) => RLPObject -> f a
rlpDecode1 = liftRlpDecode rlpDecode

rlpEncode1 :: (RLPSerializable1 f, RLPSerializable a) => f a -> RLPObject
rlpEncode1 = liftRlpEncode rlpEncode

instance Format RLPObject where
  format (RLPArray objects) =
    "[" ++ (intercalate ", " $ map format objects) ++ "]"
  format (RLPScalar n) = "0x" ++ showHex n ""
  format (RLPString s) = "0x" ++ BC.unpack (B16.encode s)

splitAtEither :: Int -> B.ByteString -> Either String (B.ByteString, B.ByteString)
splitAtEither i s | i > B.length s = Left "splitAtEither called with n > length arr"
splitAtEither i s = Right $ B.splitAt i s

getLength :: Int -> B.ByteString -> (Integer, B.ByteString)
getLength sizeOfLength bytes =
  (result,remainingbytes)
  where
    (lengthbytes,remainingbytes) = B.splitAt sizeOfLength bytes
    result = byteString2Integer lengthbytes
                                0

rlpSplit :: B.ByteString -> (RLPObject, B.ByteString)
rlpSplit = either error id . rlpSplitEither

rlpSplitMaybe :: B.ByteString -> Maybe (RLPObject, B.ByteString)
rlpSplitMaybe = either (const Nothing) Just . rlpSplitEither

rlpSplitEither :: B.ByteString -> Either String (RLPObject, B.ByteString)
rlpSplitEither input =
  case B.head input of
    x
      | x >= 192 && x <= 192 + 55 ->
        let eResult = splitAtEither (fromIntegral x - 192) $ B.tail input
         in (\(arrayData, nextRest) -> (RLPArray $ getRLPObjects arrayData, nextRest)) <$> eResult
    x
      | x >= 0xF8 && x <= 0xFF ->
        let (arrLength, restAfterLen) = getLength (fromIntegral x - 0xF7) $ B.tail input
            eResult = splitAtEither (fromIntegral arrLength) restAfterLen
         in (\(arrayData, nextRest) -> (RLPArray $ getRLPObjects arrayData, nextRest)) <$> eResult
    x
      | x >= 128 && x <= 128 + 55 ->
        let eResult = splitAtEither (fromIntegral $ x - 128) $ B.tail input
         in (\(strList, nextRest) -> (RLPString strList, nextRest)) <$> eResult
    x
      | x >= 0xB8 && x <= 0xBF ->
        let (strLength, restAfterLen) = getLength (fromIntegral x - 0xB7) $ B.tail input
            eResult = splitAtEither (fromIntegral strLength) restAfterLen
         in (\(strList, nextRest) -> (RLPString strList, nextRest)) <$> eResult
    x | x < 128 -> Right (RLPScalar x, B.tail input)
    x -> Left ("Missing case in rlpSplit: " ++ show x)

getRLPObjects :: ByteString -> [RLPObject]
getRLPObjects x | B.null x = []
getRLPObjects theData = obj : getRLPObjects rest
  where
    (obj, rest) = rlpSplit theData

int2Bytes :: Int -> [Word8]
int2Bytes val | val < 0x100 = map (fromIntegral . (val `shiftR`)) [0]
int2Bytes val | val < 0x10000 = map (fromIntegral . (val `shiftR`)) [8, 0]
int2Bytes val | val < 0x1000000 = map (fromIntegral . (val `shiftR`)) [16, 8, 0]
int2Bytes val | val < 0x100000000 = map (fromIntegral . (val `shiftR`)) [24, 16 .. 0]
int2Bytes val | val < 0x10000000000 = map (fromIntegral . (val `shiftR`)) [32, 24 .. 0]
int2Bytes _ = error "int2Bytes not defined for val >= 0x10000000000."

-- | Converts bytes to 'RLPObject's.
--
-- Full deserialization of an object can be obtained using @rlpDecode . rlpDeserialize@.
rlpDeserialize :: B.ByteString -> RLPObject
rlpDeserialize s =
  case rlpSplit s of
    (o, x) | B.null x -> o
    _ -> error ("parse error converting ByteString to an RLP Object: " ++ show (B.unpack s))

rlpDeserializeMaybe :: B.ByteString -> Maybe RLPObject
rlpDeserializeMaybe s =
  case rlpSplitMaybe s of
    Just (o, x) | B.null x -> Just o
    _ -> Nothing

rlpDeserializeEither :: B.ByteString -> Either String RLPObject
rlpDeserializeEither s =
  case rlpSplitEither s of
    Right (o, x) | B.null x -> Right o
    Right _ -> Left ("parse error converting ByteString to an RLP Object: " ++ show (B.unpack s))
    Left e -> Left e

-- | Converts 'RLPObject's to bytes.
--
-- Full serialization of an object can be obtained using @rlpSerialize . rlpEncode@.
rlpSerialize :: RLPObject -> B.ByteString
rlpSerialize = \case
  RLPScalar val -> B.singleton val
  RLPString s ->
    let l = B.length s
     in if l <= 55
          then B.cons (0x80 + fromIntegral l) s
          else
            let ibs = int2Bytes l
                ll = length ibs
             in (B.pack $ 0xb7 + fromIntegral ll : ibs) <> s
  RLPArray innerObjects -> do
    let innerBytes = B.concat . map rlpSerialize $ innerObjects
        l = B.length innerBytes
    if l <= 55
      then B.cons (0xc0 + fromIntegral l) innerBytes
      else
        let ibs = int2Bytes . fromIntegral $ l
            ll = length ibs
         in (B.pack $ 0xf7 + fromIntegral ll : ibs) <> innerBytes

instance RLPSerializable Integer where
  rlpEncode 0 = RLPString B.empty
  rlpEncode x | x < 0 = RLPArray [rlpEncode (-x)]
  rlpEncode x | x < 128 = RLPScalar $ fromIntegral x
  rlpEncode x = RLPString $ integer2Bytes x
  rlpDecode (RLPScalar x) = fromIntegral x
  rlpDecode (RLPString s) = byteString2Integer s 0
  rlpDecode (RLPArray [x]) = -rlpDecode x
  rlpDecode (RLPArray _) = error "rlpDecode called for Integer for array of wrong size"

instance RLPSerializable Word8 where
  rlpEncode w = RLPScalar w 
  rlpDecode (RLPScalar w) = w
  rlpDecode x = error $ "rlpDecode for Word8 not defined for " ++ show x

instance {-# OVERLAPPING #-} RLPSerializable String where
  rlpEncode = rlpEncode . T.pack
  rlpDecode = T.unpack . rlpDecode

instance RLPSerializable B.ByteString where
  rlpEncode x | B.length x == 1 && B.head x < 128 = RLPScalar $ B.head x
  rlpEncode s = RLPString s

  rlpDecode (RLPScalar x) = B.singleton x
  rlpDecode (RLPString s) = s
  rlpDecode x = error ("rlpDecode for ByteString not defined for: " ++ show x)

instance RLPSerializable T.Text where
  rlpEncode = rlpEncode . encodeUtf8
  rlpDecode = decodeUtf8 . rlpDecode

instance RLPSerializable a => RLPSerializable (Identity a) where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance RLPSerializable1 Identity where
  liftRlpEncode f = f . runIdentity
  liftRlpDecode f = Identity . f

instance (RLPSerializable1 f, RLPSerializable1 g, RLPSerializable a) => RLPSerializable (Compose f g a) where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance (RLPSerializable1 f, RLPSerializable1 g) => RLPSerializable1 (Compose f g) where
  liftRlpEncode f = liftRlpEncode (liftRlpEncode f) . getCompose
  liftRlpDecode f = Compose . liftRlpDecode (liftRlpDecode f)

instance RLPSerializable1 f => RLPSerializable (Fix f) where
  rlpEncode = rlpEncode1 . unFix
  rlpDecode = Fix . rlpDecode1

instance RLPSerializable a => RLPSerializable [a] where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance RLPSerializable1 [] where
  liftRlpEncode f as = RLPArray $ f <$> as
  liftRlpDecode f (RLPArray os) = f <$> os
  liftRlpDecode _ os = error $ "rlpDecode []: Expected RLPArray, got " ++ show os

-- serialization for tuples, triples, etc. of serializable types
instance (RLPSerializable a, RLPSerializable b) => RLPSerializable (a, b) where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance RLPSerializable a => RLPSerializable1 ((,) a) where
  liftRlpEncode f (a, b) = RLPArray [rlpEncode a, f b]
  liftRlpDecode f (RLPArray [a, b]) = (rlpDecode a, f b)
  liftRlpDecode _ x = error $ "rlpDecode for tuples not defined for " ++ show x

instance (RLPSerializable a, RLPSerializable b, RLPSerializable c) => RLPSerializable (a, b, c) where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance (RLPSerializable a, RLPSerializable b) => RLPSerializable1 ((,,) a b) where
  liftRlpEncode f (a, b, c) = RLPArray [rlpEncode a, rlpEncode b, f c]
  liftRlpDecode f (RLPArray [a, b, c]) = (rlpDecode a, rlpDecode b, f c)
  liftRlpDecode _ x = error $ "rlpDecode for triples not defined for " ++ show x

instance
  ( RLPSerializable a,
    RLPSerializable b,
    RLPSerializable c,
    RLPSerializable d
  ) =>
  RLPSerializable (a, b, c, d)
  where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance (RLPSerializable a, RLPSerializable b, RLPSerializable c) => RLPSerializable1 ((,,,) a b c) where
  liftRlpEncode f (a, b, c, d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, f d]
  liftRlpDecode f (RLPArray [a, b, c, d]) = (rlpDecode a, rlpDecode b, rlpDecode c, f d)
  liftRlpDecode _ x = error $ "rlpDecode for 4-tuples not defined for " ++ show x

instance
  ( RLPSerializable a,
    RLPSerializable b,
    RLPSerializable c,
    RLPSerializable d,
    RLPSerializable e
  ) =>
  RLPSerializable (a, b, c, d, e)
  where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance (RLPSerializable a, RLPSerializable b, RLPSerializable c, RLPSerializable d) => RLPSerializable1 ((,,,,) a b c d) where
  liftRlpEncode f (a, b, c, d, e) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, rlpEncode d, f e]
  liftRlpDecode f (RLPArray [a, b, c, d, e]) = (rlpDecode a, rlpDecode b, rlpDecode c, rlpDecode d, f e)
  liftRlpDecode _ x = error $ "rlpDecode for 5-tuples not defined for " ++ show x

instance
  ( RLPSerializable a,
    RLPSerializable b,
    RLPSerializable c,
    RLPSerializable d,
    RLPSerializable e,
    RLPSerializable f
  ) =>
  RLPSerializable (a, b, c, d, e, f)
  where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance (RLPSerializable a, RLPSerializable b, RLPSerializable c, RLPSerializable d, RLPSerializable e) => RLPSerializable1 ((,,,,,) a b c d e) where
  liftRlpEncode g (a, b, c, d, e, f) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, rlpEncode d, rlpEncode e, g f]
  liftRlpDecode g (RLPArray [a, b, c, d, e, f]) = (rlpDecode a, rlpDecode b, rlpDecode c, rlpDecode d, rlpDecode e, g f)
  liftRlpDecode _ x = error $ "rlpDecode for 6-tuples not defined for " ++ show x

-- generic instance for Maybe
instance (RLPSerializable a) => RLPSerializable (Maybe a) where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance RLPSerializable1 Maybe where
  liftRlpEncode _ Nothing = RLPString ""
  liftRlpEncode f (Just a) = RLPArray [f a]

  liftRlpDecode _ (RLPString "") = Nothing
  liftRlpDecode f (RLPArray [x]) = Just (f x)
  liftRlpDecode _ _ = error "error in rlpDecode for Maybe: bad RLPObject"

-- generic instance for Data.Map
instance
  (RLPSerializable k, RLPSerializable v, Ord k) =>
  RLPSerializable (M.Map k v)
  where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

instance (RLPSerializable k, Ord k) => RLPSerializable1 (M.Map k) where
  liftRlpEncode f mp = RLPArray $ map (liftRlpEncode f) (M.toList mp)
  liftRlpDecode f (RLPArray rp) = M.fromList (map (liftRlpDecode f) rp)
  liftRlpDecode _ x = error $ "rlpDecode for Map not defined for " ++ show x

instance RLPSerializable Bool where
  rlpEncode True = RLPScalar 1
  rlpEncode False = RLPScalar 0
  rlpDecode (RLPScalar 0) = False
  rlpDecode (RLPScalar 1) = True
  rlpDecode x = error $ "rlpDecode for Bool not defined for " ++ show x
