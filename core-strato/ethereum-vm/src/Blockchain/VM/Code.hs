{-# LANGUAGE BangPatterns #-}
module Blockchain.VM.Code where

import qualified Data.ByteString              as B
import qualified Data.ByteString.Base16       as B16
import qualified Data.ByteString.Char8        as C8
import qualified Data.IntSet                  as I
import Text.Printf

import qualified Blockchain.Colors            as CL
import           Blockchain.Data.Code
import           Blockchain.Util
import           Blockchain.VM.Opcodes


{-# INLINE getOperationAt #-}
getOperationAt::Code->CodePointer-> Operation
getOperationAt (Code bytes) p        = if p >= B.length bytes then STOP else toEnum . fromIntegral $ B.index bytes p
getOperationAt (PrecompiledCode _) _ = error "getOperationAt called for precompiled code"

showCode:: Code -> String
showCode (PrecompiledCode x) = CL.blue $ "<PrecompiledCode:" ++ show x ++">"
showCode (Code bytes) = unlines $ go 0
 where
  len = B.length bytes
  go :: Int -> [String]
  go !x = if x >= len
            then []
            else
      let rawOp = fromIntegral $ B.index bytes x
          op = toEnum rawOp
          dx = if PUSH1 <= op && op <= PUSH32 then 1 + rawOp - 0x60 else 0
          payload = B.take dx . B.drop (x+1) $ bytes
          payloadBytes = show . B.unpack $ payload
          payloadHex = C8.unpack . B16.encode $ payload
          payloadInt = byteString2Integer payload
      in (if dx > 1
            then printf "%x %02x%s %v %s -- %d" x rawOp payloadHex (show op) payloadBytes payloadInt
            else printf "%x %02x %s" x rawOp (show op)
         ) : go (x+1+dx)

getValidJUMPDESTs :: Code -> I.IntSet
getValidJUMPDESTs (PrecompiledCode _) = error "getValidJUMPDESTs called on precompiled code"
getValidJUMPDESTs (Code bytes) = I.fromAscList $ go 0
 where
  len = B.length bytes
  go :: Int -> [Int]
  go !x = if x >= len
            then []
            else let rawOp = fromIntegral $ B.index bytes x
                 in case toEnum rawOp of
                      JUMPDEST-> x : go (x+1)
                      op | PUSH1 <= op && op <= PUSH32 -> go (x + 2 + rawOp - 0x60)
                         | otherwise -> go (x+1)

{-# INLINE codeLength #-}
codeLength::Code->CodePointer
codeLength (Code bytes)        = B.length bytes
codeLength (PrecompiledCode _) = error "codeLength called on precompiled code"

{-# INLINE codeSlice #-}
codeSlice :: CodePointer -> CodePointer -> Code -> B.ByteString
codeSlice !start !len (Code bytes) = B.take len . B.drop start $ bytes
codeSlice _ _ (PrecompiledCode _) = error "codeSlice called on precompiled code"
