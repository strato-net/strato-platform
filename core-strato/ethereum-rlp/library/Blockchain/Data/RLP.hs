{-# LANGUAGE FlexibleInstances #-}

-- | The RLP module provides a framework within which serializers can be built, described in the Ethereum Yellowpaper (<http://gavwood.com/paper.pdf>).
--
-- The 'RLPObject' is an intermediate data container, whose serialization rules are well defined.  By creating code that converts from a
-- given type to an 'RLPObject', full serialization will be specified.  The 'RLPSerializable' class provides functions to do this conversion.

module Blockchain.Data.RLP (
  RLPObject(..),
  formatRLPObject,
  RLPSerializable(..),
  rlpSplit,
  rlpSerialize,
  rlpSerialize_safe, -- For testing
  rlpDeserialize,
  finalLength -- For testing
  ) where

import           Control.DeepSeq
import           Control.Monad.IO.Class
import           Control.Monad.Trans.State
import           Data.Bits
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Char8              as BC
import qualified Data.ByteString.Internal as BI
import           Data.ByteString.Internal
import qualified Data.Map                           as M
import qualified Data.Text                          as T
import           Data.Word
import           Foreign.ForeignPtr
import           Foreign.Ptr
import           Foreign.Storable
import           GHC.Generics
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>))
import           Numeric
import           System.IO.Unsafe

import           Blockchain.Data.Util

-- | An internal representation of generic data, with no type information.
--
-- End users will not need to directly create objects of this type (an 'RLPObject' can be created using 'rlpEncode'),
-- however the designer of a new type will need to create conversion code by making their type an instance
-- of the RLPSerializable class.
data RLPObject = RLPScalar Word8 | RLPString B.ByteString | RLPArray [RLPObject] deriving (Show, Eq, Ord, Generic)

instance NFData RLPObject

-- | Converts objects to and from 'RLPObject's.
class RLPSerializable a where
  rlpDecode::RLPObject->a
  rlpEncode::a->RLPObject


instance Pretty RLPObject where
  pretty (RLPArray objects) =
    encloseSep (text "[") (text "]") (text ", ") $ pretty <$> objects
  pretty (RLPScalar n) = text $ "0x" ++ showHex n ""
  pretty (RLPString s) = text $ "0x" ++ BC.unpack (B16.encode s)

formatRLPObject::RLPObject->String
formatRLPObject = show . pretty

splitAtWithError::Int->B.ByteString->(B.ByteString, B.ByteString)
splitAtWithError i s | i > B.length s = error "splitAtWithError called with n > length arr"
splitAtWithError i s = B.splitAt i s

getLength::Int->B.ByteString->(Integer, B.ByteString)
getLength sizeOfLength bytes =
  (bytes2Integer $ B.unpack $ B.take sizeOfLength bytes, B.drop sizeOfLength bytes)

rlpSplit::B.ByteString->(RLPObject, B.ByteString)
rlpSplit input =
  case B.head input of
    x | x >= 192 && x <= 192+55 ->
      let (arrayData, nextRest) =
            splitAtWithError (fromIntegral x - 192) $ B.tail input
      in (RLPArray $ getRLPObjects arrayData, nextRest)

    x | x >= 0xF8 && x <= 0xFF ->
      let
        (arrLength, restAfterLen) = getLength (fromIntegral x - 0xF7) $ B.tail input
        (arrayData, nextRest) = splitAtWithError (fromIntegral arrLength) restAfterLen
      in (RLPArray $ getRLPObjects arrayData, nextRest)

    x | x >= 128 && x <= 128+55 ->
      let
        (strList, nextRest) = splitAtWithError (fromIntegral $ x - 128) $ B.tail input
      in
       (RLPString strList, nextRest)

    x | x >= 0xB8 && x <= 0xBF ->
      let
        (strLength, restAfterLen) = getLength (fromIntegral x - 0xB7) $ B.tail input
        (strList, nextRest) = splitAtWithError (fromIntegral strLength) restAfterLen
      in
       (RLPString strList, nextRest)

    x | x < 128 -> (RLPScalar x, B.tail input)

    x -> error ("Missing case in rlpSplit: " ++ show x)


getRLPObjects::ByteString->[RLPObject]
getRLPObjects x | B.null x = []
getRLPObjects theData = obj:getRLPObjects rest
  where
    (obj, rest) = rlpSplit theData

int2Bytes::Int->[Word8]
int2Bytes val | val < 0x100 = map (fromIntegral . (val `shiftR`)) [0]
int2Bytes val | val < 0x10000 = map (fromIntegral . (val `shiftR`)) [8, 0]
int2Bytes val | val < 0x1000000 = map (fromIntegral . (val `shiftR`)) [16,  8, 0]
int2Bytes val | val < 0x100000000 = map (fromIntegral . (val `shiftR`)) [24, 16..0]
int2Bytes val | val < 0x10000000000 = map (fromIntegral . (val `shiftR`)) [32, 24..0]
int2Bytes _ = error "int2Bytes not defined for val >= 0x10000000000."


-- | Converts bytes to 'RLPObject's.
--
-- Full deserialization of an object can be obtained using @rlpDecode . rlpDeserialize@.
rlpDeserialize::B.ByteString->RLPObject
rlpDeserialize s =
  case rlpSplit s of
    (o, x) | B.null x -> o
    _ -> error ("parse error converting ByteString to an RLP Object: " ++ show (B.unpack s))


-- | Converts 'RLPObject's to bytes.
--
-- Full serialization of an object can be obtained using @rlpSerialize . rlpEncode@.

log256 :: Int -> Int
log256 val | val < 0x100 = 1
log256 val | val < 0x10000 = 2
log256 val | val < 0x1000000 = 3
log256 val | val < 0x100000000 = 4
log256 val | val < 0x10000000000 = 5
log256 val = error $ "log256 not defined for val=" ++ show val

finalLength :: RLPObject -> Int
finalLength (RLPScalar{}) = 1
finalLength (RLPString s) = let sub = B.length s in 1 + log256 sub + sub
finalLength (RLPArray cs) = let sub = sum . map finalLength $ cs
                            in 1 + log256 sub + sub

{-
 - This algorithm does two passes over the RLP. The first calculates the
 - length, which a buffer is allocated for.  The second does a reverse post
 - order tree traversal (children first, from right to left) and writes to the buffer
 - from right to left. The change in pointer position is then used to calculate
 - the total payload length of a node and written into the RLP header.
 -}
rlpSerialize :: RLPObject -> B.ByteString
rlpSerialize (s@RLPScalar{}) = rlpSerialize_safe s
rlpSerialize (s@RLPString{}) = rlpSerialize_safe s
rlpSerialize rlp = let maxLen = finalLength rlp
                   in fst . unsafePerformIO $ BI.createAndTrim' maxLen $ \p0 -> do
  let pEnd = p0 `plusPtr` maxLen
  pStart <- execStateT (loop rlp) pEnd
  return (pStart `minusPtr` p0, pEnd `minusPtr` pStart, ())

  where loop :: RLPObject -> StateT (Ptr Word8) IO ()
        loop (RLPScalar x) = do
          p <- gets (`plusPtr` (-1))
          liftIO $ poke p x
          put p
        loop (RLPString (BI.PS fsrc off len)) = do
          pPayloadStart <- gets (`plusPtr` (-len))
          liftIO $ withForeignPtr fsrc $ \src -> BI.memcpy pPayloadStart (src `plusPtr` off) (fromIntegral len)
          if len <= 55
            then do
              let pHeaderStart = pPayloadStart `plusPtr` (-1)
              liftIO . poke pHeaderStart $ 0x80 + fromIntegral len
              put pHeaderStart
            else do
              put pPayloadStart
              intLoop len
              pLenStart <- get
              let pHeaderStart = pLenStart `plusPtr` (-1)
              liftIO . poke pHeaderStart $ 0xb7 + (fromIntegral $ pPayloadStart `minusPtr` pLenStart)
              put pHeaderStart
        loop (RLPArray xs) = do
          pPayloadEnd <- get
          mapM_ loop $ reverse xs
          pPayloadStart <- get
          let len = pPayloadEnd `minusPtr` pPayloadStart
          if len <= 55
            then do
              let pHeaderStart = pPayloadStart `plusPtr` (-1)
              liftIO . poke pHeaderStart $ 0xc0 + fromIntegral len
              put pHeaderStart
            else do
              intLoop len
              pLenStart <- get
              let pHeaderStart = pLenStart `plusPtr` (-1)
              liftIO . poke pHeaderStart $ 0xf7 + (fromIntegral $ pPayloadStart `minusPtr` pLenStart)
              put pHeaderStart

        intLoop :: Int -> StateT (Ptr Word8) IO ()
        intLoop 0 = return ()
        intLoop n = do
          p <- gets (`plusPtr` (-1))
          liftIO $ poke p $ fromIntegral n
          put p
          intLoop (n `shiftR` 8)

rlpSerialize_safe :: RLPObject -> B.ByteString
rlpSerialize_safe = \case
  RLPScalar val -> B.singleton val
  RLPString s ->
    let l = B.length s
    in if l <= 55
         then B.cons (0x80 + fromIntegral l) s
         else let ibs = int2Bytes l
                  ll = length ibs
              in (B.pack $ 0xb7 + fromIntegral ll:ibs) <> s
  RLPArray innerObjects -> do
    let innerBytes = B.concat . map rlpSerialize_safe $ innerObjects
        l = B.length innerBytes
    if l <= 55
      then B.cons (0xc0 + fromIntegral l) innerBytes
      else
        let ibs = int2Bytes . fromIntegral $ l
            ll = length ibs
        in (B.pack $ 0xf7 + fromIntegral ll:ibs) <> innerBytes

instance RLPSerializable Integer where
  rlpEncode 0             = RLPString B.empty
  rlpEncode x | x < 0     = error "cannot encode negative numbers in RLP"
  rlpEncode x | x < 128   = RLPScalar $ fromIntegral x
  rlpEncode x             = RLPString $ B.pack $ integer2Bytes x
  rlpDecode (RLPScalar x) = fromIntegral x
  rlpDecode (RLPString s) = byteString2Integer s
  rlpDecode (RLPArray _)  = error "rlpDecode called for Integer for array"

instance {-# OVERLAPPING #-} RLPSerializable String where
  rlpEncode s = rlpEncode $ BC.pack s

  rlpDecode (RLPString s) = BC.unpack s
  rlpDecode (RLPScalar n) = [w2c $ fromIntegral n]
  rlpDecode (RLPArray x) = error $ "Malformed RLP in call to rlpDecode for String: RLPObject is an array: " ++ show (pretty x)

instance RLPSerializable B.ByteString where
    rlpEncode x | B.length x == 1 && B.head x < 128 = RLPScalar $ B.head x
    rlpEncode s = RLPString s

    rlpDecode (RLPScalar x) = B.singleton x
    rlpDecode (RLPString s) = s
    rlpDecode x = error ("rlpDecode for ByteString not defined for: " ++ show x)

instance RLPSerializable T.Text where
  rlpEncode = rlpEncode . T.unpack
  rlpDecode = T.pack . rlpDecode

instance RLPSerializable a => RLPSerializable [a] where
  rlpEncode as = RLPArray $ map rlpEncode as
  rlpDecode (RLPArray as) = map rlpDecode as
  rlpDecode x = error $ "rlpDecode [a]: Expected RLPArray, got " ++ show x

-- serialization for tuples, triples, etc. of serializable types
instance (RLPSerializable a, RLPSerializable b) => RLPSerializable (a,b) where
  rlpEncode (a,b) = RLPArray [rlpEncode a, rlpEncode b]
  rlpDecode (RLPArray [a,b]) = (rlpDecode a, rlpDecode b)
  rlpDecode x = error $ "rlpDecode for tuples not defined for " ++ show x

instance (RLPSerializable a, RLPSerializable b, RLPSerializable c) => RLPSerializable (a,b,c) where
  rlpEncode (a,b,c) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpDecode (RLPArray [a,b,c]) = (rlpDecode a, rlpDecode b, rlpDecode c)
  rlpDecode x = error $ "rlpDecode for triples not defined for " ++ show x

instance
  ( RLPSerializable a
  , RLPSerializable b
  , RLPSerializable c
  , RLPSerializable d
  ) => RLPSerializable (a,b,c,d) where
  rlpEncode (a,b,c,d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, rlpEncode d]
  rlpDecode (RLPArray [a,b,c,d]) = (rlpDecode a, rlpDecode b, rlpDecode c, rlpDecode d)
  rlpDecode x = error $ "rlpDecode for 4-tuples not defined for " ++ show x

instance
  ( RLPSerializable a
  , RLPSerializable b
  , RLPSerializable c
  , RLPSerializable d
  , RLPSerializable e
  ) => RLPSerializable (a,b,c,d,e) where
  rlpEncode (a,b,c,d,e) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, rlpEncode d, rlpEncode e]
  rlpDecode (RLPArray [a,b,c,d,e]) = (rlpDecode a, rlpDecode b, rlpDecode c, rlpDecode d, rlpDecode e)
  rlpDecode x = error $ "rlpDecode for 5-tuples not defined for " ++ show x

instance
  ( RLPSerializable a
  , RLPSerializable b
  , RLPSerializable c
  , RLPSerializable d
  , RLPSerializable e
  , RLPSerializable f
  ) => RLPSerializable (a,b,c,d,e,f) where
  rlpEncode (a,b,c,d,e,f) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, rlpEncode d, rlpEncode e, rlpEncode f]
  rlpDecode (RLPArray [a,b,c,d,e,f]) = (rlpDecode a, rlpDecode b, rlpDecode c, rlpDecode d, rlpDecode e, rlpDecode f)
  rlpDecode x = error $ "rlpDecode for 6-tuples not defined for " ++ show x


-- generic instance for Maybe
instance (RLPSerializable a) => RLPSerializable (Maybe a) where
  rlpEncode Nothing = RLPString ""
  rlpEncode (Just a) = RLPArray [rlpEncode a]

  rlpDecode (RLPString "") = Nothing
  rlpDecode (RLPArray [x]) = Just (rlpDecode x)
  rlpDecode _ = error "error in rlpDecode for Maybe: bad RLPObject"


-- generic instance for Data.Map
instance (RLPSerializable k, RLPSerializable v, Ord k)
  => RLPSerializable (M.Map k v) where
  rlpEncode mp = RLPArray $ map rlpEncode (M.toList mp)
  rlpDecode (RLPArray rp) = M.fromList (map rlpDecode rp)
  rlpDecode x = error $ "rlpDecode for Map not defined for " ++ show x

instance RLPSerializable Bool where
  rlpEncode True = RLPScalar 1
  rlpEncode False = RLPScalar 0
  rlpDecode (RLPScalar 0) = False
  rlpDecode (RLPScalar 1) = True
  rlpDecode x = error $ "rlpDecode for Bool not defined for " ++ show x
