{-# LANGUAGE TypeSynonymInstances #-}

-- | 'NibbleString' is the "'ByteString'" of nibbles (4 bit values).  It is intended to be used in the same way that 'ByteString' is used,
-- although, currently, only a subset of the functions have been implemented.
--
-- Internally, a 'NibbleString' stores data similarly to 'ByteString', however, as per design:
--
--    - Each byte of data in a 'NibbleString' contributes 2 to the length.
--    - When unpacked, each byte of data in a 'NibbleString' creates 2 'Nibble' items.
--    - Unlike a 'ByteString', a 'NibbleString' can hold an odd number of Nibbles.
--
-- For the most part, 'NibbleString' is a convenience wrapper around 'ByteString'
module Data.NibbleString
  ( Nibble,
    NibbleString (..),
    empty,
    singleton,
    null,
    length,
    pack,
    unpack,
    byte2Nibbles,
    isPrefixOf,
    head,
    tail,
    cons,
    take,
    drop,
    append,
  )
where

import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Function (on)
import qualified Data.List as L (take)
import Data.Ranged.Boundaries
import Data.String
import Data.Word
import Numeric
import Text.Colors
import Text.Format
import Prelude hiding (drop, head, length, null, tail, take)
import qualified Prelude

-- | Nibbles are stored as the low four bits of a Word8.
--
-- Nothing prevents storing 1s in the upper four bits, but the functions here will (do their best to) ignore this data, or complain when it is set.
type Nibble = Word8

-- | This is the basic 'NibbleString' data type.
--
-- A 'NibbleString' is just a 'ByteString' internally, but with a spot to store the extra Nibble for odd length strings.
data NibbleString = EvenNibbleString B.ByteString | OddNibbleString Nibble B.ByteString deriving (Show, Eq)

instance Ord NibbleString where
  compare = compare `on` unpack

instance DiscreteOrdered NibbleString where
  adjacent _ _ = False
  adjacentBelow _ = Nothing

instance Format NibbleString where
  format (EvenNibbleString s) = blue $ BC.unpack (B16.encode s)
  format (OddNibbleString c s) = blue $ showHex c "" ++ BC.unpack (B16.encode s)

instance IsString NibbleString where
  fromString "" = EvenNibbleString B.empty
  fromString s | even $ Prelude.length s = case B16.decode $ BC.pack s of
    Right x -> EvenNibbleString x
    _ -> error ("fromString conversion to NibbleString failed.  The string was of the wrong format: " ++ show s)
  fromString (c : rest) = case B16.decode $ BC.pack rest of
    Right x ->
      case readHex [c] of
        [(w, "")] -> OddNibbleString w x
        _ -> error ("fromString conversion to NibbleString failed.  The string was of the wrong format: " ++ show (c : rest))
    _ -> error ("fromString conversion to NibbleString failed.  The string was of the wrong format: " ++ show (c : rest))

-- | /O(1)/ Returns the number of Nibbles stored in the 'NibbleString'.
--
-- The value returned will be double that stored in an identical 'ByteString'.
length :: NibbleString -> Int
length (EvenNibbleString s) = B.length s `shiftL` 1
length (OddNibbleString _ s) = 1 + B.length s `shiftL` 1

-- | /O(1)/ Creates a 'NibbleString' of length 1 using the given 'Nibble'.
singleton :: Nibble -> NibbleString
singleton c | c > 0xF = error "singleton: Nibble overflow"
singleton c = OddNibbleString c B.empty

-- | /O(1)/ Returns 'True' if the 'NibbleString' has size 0.
null :: NibbleString -> Bool
null (EvenNibbleString s) = B.null s
null (OddNibbleString _ _) = False

-- | /O(1)/ Returns the 'NibbleString' of length 0.
empty :: NibbleString
empty = EvenNibbleString B.empty

-- | /O(n)/ Creates a new 'NibbleString' by appending one to another.
append :: NibbleString -> NibbleString -> NibbleString
--First check for the more efficient stuff (I could probably add more stuff here)
append (EvenNibbleString s1) (EvenNibbleString s2) = EvenNibbleString (s1 `B.append` s2)
append (OddNibbleString c1 s1) (EvenNibbleString s2) = OddNibbleString c1 (s1 `B.append` s2)
append (OddNibbleString c1 s1) (OddNibbleString c2 s2) | B.null s1 = EvenNibbleString (B.cons (c1 `shiftL` 4 + c2) $ s1 `B.append` s2)
--Then fallback to something less efficient
append x y = pack (unpack x ++ unpack y)

-- | /O(1)/ Returns the first 'Nibble' in a 'NibbleString'.
head :: NibbleString -> Nibble
head (EvenNibbleString s) | B.null s = error "Empty NibbleString"
head (OddNibbleString c _) = c
head (EvenNibbleString s) = B.head s `shiftR` 4

-- | /O(1)/ Returns the 'NibbleString' remaining after removing the head Nibble.
tail :: NibbleString -> NibbleString
tail (EvenNibbleString s) | B.null s = error "Empty NibbleString"
tail (OddNibbleString _ s) = EvenNibbleString s
tail (EvenNibbleString s) = OddNibbleString (B.head s .&. 0xF) $ B.tail s

-- | /O(n)/ Convert a ['Nibble'] into a 'NibbleString'.
pack :: [Nibble] -> NibbleString
pack (c : _) | c > 0xf = error "pack: Nibble overflow"
pack (c : rest) | even $ Prelude.length rest = c `prependNibble` pack rest
  where
    prependNibble c2 (EvenNibbleString x) = OddNibbleString c2 x
    prependNibble _ (OddNibbleString _ _) = undefined
pack x = EvenNibbleString $ B.pack (nibbles2Bytes x)
  where
    nibbles2Bytes :: [Nibble] -> [Word8]
    nibbles2Bytes [] = []
    nibbles2Bytes [_] = error "Error in N.pack, nibbles2Bytes: an odd length string was passed into nibbles2Bytes" --shouldn't ever be here, list length should be odd
    nibbles2Bytes (x1 : x2 : _) | x1 > 0xF || x2 > 0xF = error "pack: Nibble overflow"
    nibbles2Bytes (x1 : x2 : rest) = x1 `shiftL` 4 + x2 : nibbles2Bytes rest

-- | /O(n)/ Convert a 'NibbleString' into a ['Nibble'].
unpack :: NibbleString -> [Nibble]
unpack (OddNibbleString c rest) = c : unpack (EvenNibbleString rest)
unpack (EvenNibbleString x) = byte2Nibbles =<< B.unpack x

-- | /O(1)/ Convert one byte to a list of 2 Nibbles.
--
-- This can be useful in converting lists of bytes to a 'NibbleString'.
--
-- @nibbleString = pack $ byte2Nibbles =<< listOfBytes@
byte2Nibbles :: Word8 -> [Nibble]
byte2Nibbles x = [x `shiftR` 4, x .&. 0xF]

-- | /O(n)/ Returns 'True' if the first 'NibbleString' is a prefix of the second.
isPrefixOf :: NibbleString -> NibbleString -> Bool
isPrefixOf (EvenNibbleString s1) _ | B.null s1 = True
isPrefixOf (EvenNibbleString s1) (EvenNibbleString s2) = s1 `B.isPrefixOf` s2
isPrefixOf (OddNibbleString c1 s1) n2 =
  case length n2 of
    0 -> False
    _ -> c1 == head n2 && EvenNibbleString s1 `isPrefixOf` tail n2
isPrefixOf n1 n2 | head n1 == head n2 = tail n1 `isPrefixOf` tail n2
isPrefixOf (EvenNibbleString s1) (OddNibbleString c2 s2) = c1 == c2 && OddNibbleString c1 (B.tail s1) `isPrefixOf` EvenNibbleString s2
  where
    c1 = B.head s1 `shiftR` 4

-- | /O(n)/ @cons n s@ returns a new 'NibbleString' by prepending n to the given 'NibbleString'.
--
-- For $s$ of even length, the operation occurs in /O(1)/, however for odd length, the underlying bytearray needs to be copied.
cons :: Nibble -> NibbleString -> NibbleString
cons n (EvenNibbleString s) = OddNibbleString n s
cons n1 (OddNibbleString n2 s) = EvenNibbleString ((n1 `shiftL` 4 + n2) `B.cons` s)

-- | /O(1)/ @drop n@ returns a new 'NibbleString' by dropping the first n Nibbles from the given 'NibbleString'.
drop :: Int -> NibbleString -> NibbleString
drop 0 s = s
drop n s | n > length s = empty
drop n (EvenNibbleString s) | even n = EvenNibbleString (B.drop (n `shiftR` 1) s)
drop 1 s = tail s
drop n (EvenNibbleString s) = drop 1 $ EvenNibbleString (B.drop ((n - 1) `shiftR` 1) s)
drop n (OddNibbleString _ s) | even n = drop (n - 1) $ EvenNibbleString s
drop n (OddNibbleString _ s) = drop (n - 1) $ EvenNibbleString s

-- | /O(n)/ @take n@ returns a new 'NibbleString' by dropping the first n Nibbles from the given 'NibbleString'.
--
-- Note- This works similarly to the ByteString version of take, although it runs at (worst case) in O(n).
-- The reason for this, is, because if the even-odd nibbles are misaligned after the take, the whole array needs to
-- be copied to shift things over correctly.
take :: Int -> NibbleString -> NibbleString
--Fast /O(1)/ stuff
take 0 _ = empty
take 1 s = singleton $ head s
take n s | n > length s = s
take n (EvenNibbleString s) | even n = EvenNibbleString (B.take (n `shiftR` 1) s)
take n (OddNibbleString c s) | odd n = OddNibbleString c (B.take ((n - 1) `shiftR` 1) s)
--Slow /O(n)/ stuff
take n s = pack $ L.take n $ unpack s
