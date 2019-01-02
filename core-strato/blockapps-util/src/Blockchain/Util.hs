{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module Blockchain.Util where

import           Control.Monad.State.Lazy (State, execState, get, put)
import qualified Data.Binary              as Binary
import           Data.Bits
import qualified Data.ByteString          as B
import           Data.ByteString.Internal
import           Data.Char
import qualified Data.Map.Strict          as M
import qualified Data.NibbleString        as N
import           Data.Word
import           Numeric
import           Data.Time.Clock.POSIX    (POSIXTime, getPOSIXTime)

import           Blockchain.ExtWord


toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

buildState :: s -> [a] -> (a -> State s ()) -> s
buildState s [] _ = s
buildState s (a:as) run =
  let s' = execState (run a) s
   in buildState s' as run

partitionWith :: Ord k => (a -> k) -> [a] -> [(k,[a])]
partitionWith f as = M.toList . buildState M.empty as $ \a -> do
  s <- get
  let k = f a
  case M.lookup k s of
    Nothing -> put (M.insert k [a] s)
    Just _  -> put (M.update (Just . (++ [a])) k s)

showHex4 :: Word256 -> String
showHex4 i = replicate (4 - length rawOutput) '0' ++ rawOutput
    where rawOutput = showHex i ""

showHexU :: Integer -> String
showHexU = map toUpper . flip showHex ""

nibbleString2ByteString::N.NibbleString->B.ByteString
nibbleString2ByteString (N.EvenNibbleString s)  = s
nibbleString2ByteString (N.OddNibbleString c s) = c `B.cons` s

byteString2NibbleString::B.ByteString->N.NibbleString
byteString2NibbleString = N.EvenNibbleString

--I hate this, it is an ugly way to create an Integer from its component bytes.
--There should be an easier way....
--See http://stackoverflow.com/questions/25854311/efficient-packing-bytes-into-integers
byteString2Integer::B.ByteString->Integer
byteString2Integer x = bytes2Integer $ B.unpack x

bytes2Integer::[Word8]->Integer
bytes2Integer []          = 0
bytes2Integer (byte:rest) = fromIntegral byte `shift` (8 * length rest) + bytes2Integer rest

integer2Bytes::Integer->[Word8]
integer2Bytes 0 = []
integer2Bytes x = integer2Bytes (x `shiftR` 8) ++ [fromInteger (x .&. 255)]

--integer2Bytes1 is integer2Bytes, but with the extra condition that the output be of length 1 or more.
integer2Bytes1::Integer->[Word8]
integer2Bytes1 0 = [0]
integer2Bytes1 x = integer2Bytes x

word256ToBytes :: Word256 -> B.ByteString
word256ToBytes ws =
  let n = getBigWordInteger ws
  in case n of
    S# i# -> unsafePerformIO $ do
      dst <- newPinnedByteArray 32
      writeByteArray dst 3 (toBE64 (W64# (int2Word# i#)))
      let !(Addr addr#) = PBA.mutableByteArrayContents dst
      BU.unsafePackAddressLen 32 addr#
    Jp# bn -> unsafePerformIO $ do
      dst <- newPinnedByteArray 32
      case sizeofBigNat# bn of
        1# -> do
          writeByteArray dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
        2# -> do
          writeByteArray dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
          writeByteArray dst 2 (toBE64 (W64# (indexBigNat# bn 1#)))
        3# -> do
          writeByteArray dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
          writeByteArray dst 2 (toBE64 (W64# (indexBigNat# bn 1#)))
          writeByteArray dst 1 (toBE64 (W64# (indexBigNat# bn 2#)))
        4# -> do
          writeByteArray dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
          writeByteArray dst 2 (toBE64 (W64# (indexBigNat# bn 1#)))
          writeByteArray dst 1 (toBE64 (W64# (indexBigNat# bn 2#)))
          writeByteArray dst 0 (toBE64 (W64# (indexBigNat# bn 3#)))
        k# -> error $ "Word256 overflow or unanticipated architecture" ++ show (I# k#)
      let !(Addr addr#) = PBA.mutableByteArrayContents dst
      BU.unsafePackAddressLen 32 addr#
    _ -> error "negative Word256"

padZeros::Int->String->String
padZeros n s = replicate (n - length s) '0' ++ s

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

newtype Microtime = Microtime Integer deriving (Read, Show, Eq, Ord, Num, Enum, Real, Integral)

posixTimeToMicrotime :: POSIXTime -> Microtime
posixTimeToMicrotime = Microtime . round . (* 1000000)

secondsToMicrotime :: Integer -> Microtime
secondsToMicrotime = Microtime . (* 1000000)

getCurrentMicrotime :: IO Microtime
getCurrentMicrotime = posixTimeToMicrotime <$> getPOSIXTime

instance Binary.Binary Microtime where
    get = Microtime <$> Binary.get
    put (Microtime a) = Binary.put a
