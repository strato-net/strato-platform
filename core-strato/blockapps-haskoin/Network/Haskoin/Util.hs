-- {-# OPTIONS -fno-warn-unused-top-binds #-}

{-|
  This module defines various utility functions used across the
  Network.Haskoin modules.
-}
module Network.Haskoin.Util
(
  -- * ByteString helpers
  stringToBS
, bsToInteger
, integerToBS
, bsToHex
, hexToBS

, encode'
, decode'
, runPut'
, runGet'
, decodeToMaybe
, isolate
, maybeToEither
) where

import Control.Monad (guard)

import Data.Word (Word8)
import Data.Bits ((.|.), shiftL, shiftR)
import Data.List (unfoldr)
import Data.Binary.Put (Put, runPut)
import Data.Binary (Binary, encode, decode, decodeOrFail)
import Data.Binary.Get (Get, runGetOrFail, getByteString, ByteOffset, runGet)

import qualified Data.ByteString.Lazy as BL (ByteString, toChunks, fromChunks)
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C (pack, unpack)
import qualified Data.ByteString as BS
    (ByteString, concat, pack, unpack, null, empty)

-- ByteString helpers

-- | Transforms a lazy bytestring into a strict bytestring
toStrictBS :: BL.ByteString -> BS.ByteString
toStrictBS = BS.concat . BL.toChunks

-- | Transforms a strict bytestring into a lazy bytestring
toLazyBS :: BS.ByteString -> BL.ByteString
toLazyBS bs = BL.fromChunks [bs]

-- | Transforms a string into a strict bytestring
stringToBS :: String -> BS.ByteString
stringToBS = C.pack

-- | Transform a strict bytestring to a string
bsToString :: BS.ByteString -> String
bsToString = C.unpack

-- | Decode a big endian Integer from a bytestring
bsToInteger :: BS.ByteString -> Integer
bsToInteger = (foldr f 0) . reverse . BS.unpack
  where
    f w n = (toInteger w) .|. shiftL n 8

-- | Encode an Integer to a bytestring as big endian
integerToBS :: Integer -> BS.ByteString
integerToBS 0 = BS.pack [0]
integerToBS i
    | i > 0     = BS.pack $ reverse $ unfoldr f i
    | otherwise = error "integerToBS not defined for negative values"
  where
    f 0 = Nothing
    f x = Just $ (fromInteger x :: Word8, x `shiftR` 8)

-- | Encode a bytestring to a base16 (HEX) representation
bsToHex :: BS.ByteString -> String
bsToHex = bsToString . B16.encode

-- | Decode a base16 (HEX) string from a bytestring. This function can fail
-- if the string contains invalid HEX characters
hexToBS :: String -> Maybe BS.ByteString
hexToBS xs = guard (bad == BS.empty) >> return x
  where
    (x, bad) = B16.decode $ stringToBS xs

-- Data.Binary helpers

-- | Strict version of @Data.Binary.encode@
encode' :: Binary a => a -> BS.ByteString
encode' = toStrictBS . encode

-- | Strict version of @Data.Binary.decode@
decode' :: Binary a => BS.ByteString -> a
decode' = decode . toLazyBS

-- | Strict version of @Data.Binary.runGet@
runGet' :: Get a -> BS.ByteString -> a
runGet' m = (runGet m) . toLazyBS

-- | Strict version of @Data.Binary.runPut@
runPut' :: Put -> BS.ByteString
runPut' = toStrictBS . runPut

-- | Strict version of @Data.Binary.decodeOrFail@
decodeOrFail' ::
    Binary a =>
    BS.ByteString ->
    Either (BS.ByteString, ByteOffset, String) (BS.ByteString, ByteOffset, a)
decodeOrFail' bs = case decodeOrFail $ toLazyBS bs of
    Left  (lbs,o,err) -> Left  (toStrictBS lbs,o,err)
    Right (lbs,o,res) -> Right (toStrictBS lbs,o,res)

-- | Strict version of @Data.Binary.runGetOrFail@
runGetOrFail' :: Get a -> BS.ByteString ->
    Either (BS.ByteString, ByteOffset, String) (BS.ByteString, ByteOffset, a)
runGetOrFail' m bs = case runGetOrFail m $ toLazyBS bs of
    Left  (lbs,o,err) -> Left  (toStrictBS lbs,o,err)
    Right (lbs,o,res) -> Right (toStrictBS lbs,o,res)

-- | Try to decode a Data.Binary value. If decoding succeeds, apply the function
-- to the result. Otherwise, return the default value.
fromDecode :: Binary a
           => BS.ByteString -- ^ The bytestring to decode
           -> b             -- ^ Default value to return when decoding fails
           -> (a -> b)      -- ^ Function to apply when decoding succeeds
           -> b             -- ^ Final result
fromDecode bs def f = either (const def) (f . lst) $ decodeOrFail' bs
  where
    lst (_,_,c) = c


-- | Decode a Data.Binary value into the Maybe monad. A Just value is returned
-- with the result upon success. Otherwise, Nothing is returned.
decodeToMaybe :: Binary a => BS.ByteString -> Maybe a
decodeToMaybe bs = fromDecode bs Nothing Just

-- | Isolate a Data.Binary.Get monad for the next @Int@ bytes. Only the next
-- @Int@ bytes of the input bytestring will be available for the Get monad to
-- consume. This function will fail if the Get monad fails or some of the input
-- is not consumed.
isolate :: Int -> Get a -> Get a
isolate i g = do
    bs <- getByteString i
    case runGetOrFail' g bs of
        Left (_, _, err) -> fail err
        Right (unconsumed, _, res)
            | BS.null unconsumed -> return res
            | otherwise          -> fail "Isolate: unconsumed input"

-- Maybe and Eithre monad helpers


-- | Transforms a Maybe value into an Either value. Just is mapped to Right and
-- Nothing is mapped to Left. You also pass in an error value in case Left is
-- returned.
maybeToEither :: b -> Maybe a -> Either b a
maybeToEither err m = maybe (Left err) Right m

