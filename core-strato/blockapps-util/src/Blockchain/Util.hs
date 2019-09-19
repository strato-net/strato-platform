{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE NoDeriveAnyClass #-}

module Blockchain.Util
  ( module Blockchain.Util
  , module Blockchain.Strato.Model.Util
  ) where

import           Control.Monad.State.Lazy (State, execState)
import           Data.Bits
import qualified Data.ByteString          as B
import           Data.ByteString.Internal
import           Data.Char
import           Data.Data
import qualified Data.Map.Strict          as M
import           Data.Maybe               (fromMaybe)
import           Data.Word
import           Numeric

import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Util

import           Data.Time.Clock.POSIX    (POSIXTime, getPOSIXTime)

import qualified Data.Binary              as Binary

toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

buildState :: s -> [a] -> (a -> State s ()) -> s
buildState s [] _ = s
buildState s (a:as) run =
  let s' = execState (run a) s
   in buildState s' as run

partitionWith :: Ord k => (a -> k) -> [a] -> [(k,[a])]
partitionWith f = M.toList . foldr g M.empty
  where g a = M.alter (Just . (a:) . fromMaybe []) (f a)

showHex4 :: Word256 -> String
showHex4 i = replicate (4 - length rawOutput) '0' ++ rawOutput
    where rawOutput = showHex i ""

showHexU :: Integer -> String
showHexU = map toUpper . flip showHex ""

--I hate this, it is an ugly way to create an Integer from its component bytes.
--There should be an easier way....
--See http://stackoverflow.com/questions/25854311/efficient-packing-bytes-into-integers
integer2Bytes::Integer->[Word8]
integer2Bytes 0 = []
integer2Bytes x = integer2Bytes (x `shiftR` 8) ++ [fromInteger (x .&. 255)]

--integer2Bytes1 is integer2Bytes, but with the extra condition that the output be of length 1 or more.
integer2Bytes1::Integer->[Word8]
integer2Bytes1 0 = [0]
integer2Bytes1 x = integer2Bytes x

tab::String->String
tab []          = []
tab ('\n':rest) = '\n':' ':' ':' ':' ':tab rest
tab (c:rest)    = c:tab rest

showWord8::Word8->Char
showWord8 c | c >= 32 && c < 127 = w2c c
showWord8 _ = '?'

showMem::Int->[Word8]->String
showMem _ x | length x > 1000 = " mem size greater than 1000 bytes"
showMem _ [] = ""
showMem p (v1:v2:v3:v4:v5:v6:v7:v8:rest) =
    padZeros 4 (showHex p "") ++ " "
             ++ [showWord8 v1] ++ [showWord8 v2] ++ [showWord8 v3] ++ [showWord8 v4]
             ++ [showWord8 v5] ++ [showWord8 v6] ++ [showWord8 v7] ++ [showWord8 v8] ++ " "
             ++ padZeros 2 (showHex v1 "") ++ " " ++ padZeros 2 (showHex v2 "") ++ " " ++ padZeros 2 (showHex v3 "") ++ " " ++ padZeros 2 (showHex v4 "") ++ " "
             ++ padZeros 2 (showHex v5 "") ++ " " ++ padZeros 2 (showHex v6 "") ++ " " ++ padZeros 2 (showHex v7 "") ++ " " ++ padZeros 2 (showHex v8 "") ++ "\n"
             ++ showMem (p+8) rest
showMem p x = padZeros 4 (showHex p "") ++ " " ++ (showWord8 <$> x) ++ " " ++ unwords (padZeros 2 . flip showHex "" <$> x)


safeTake::Word256->B.ByteString->B.ByteString
safeTake i _ | i > 0x7fffffffffffffff = error "error in call to safeTake: string too long"
safeTake i s | i > fromIntegral (B.length s) = s `B.append` B.replicate (fromIntegral i - B.length s) 0
safeTake i s = B.take (fromIntegral i) s

safeDrop::Word256->B.ByteString->B.ByteString
safeDrop i s | i > fromIntegral (B.length s) = B.empty
safeDrop i _ | i > 0x7fffffffffffffff = error "error in call to safeDrop: string too long"
safeDrop i s = B.drop (fromIntegral i) s

safeIntDrop :: Int -> B.ByteString -> B.ByteString
safeIntDrop i s | i > B.length s = B.empty
safeIntDrop i s = B.drop i s


isContiguous::(Eq a, Num a)=>[a]->Bool
isContiguous []         = True
isContiguous [_]        = True
isContiguous (x:y:rest) | y == x + 1 = isContiguous $ y:rest
isContiguous _          = False

newtype Microtime = Microtime Integer deriving (Read, Show, Eq, Ord, Num, Enum, Real, Integral, Data, Typeable)

posixTimeToMicrotime :: POSIXTime -> Microtime
posixTimeToMicrotime = Microtime . round . (* 1000000)

secondsToMicrotime :: Integer -> Microtime
secondsToMicrotime = Microtime . (* 1000000)

getCurrentMicrotime :: IO Microtime
getCurrentMicrotime = posixTimeToMicrotime <$> getPOSIXTime

instance Binary.Binary Microtime where
    get = Microtime <$> Binary.get
    put (Microtime a) = Binary.put a
