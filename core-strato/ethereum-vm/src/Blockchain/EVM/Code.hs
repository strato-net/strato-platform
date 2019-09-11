{-# LANGUAGE BangPatterns #-}
module Blockchain.EVM.Code where

import qualified Data.ByteString              as B
import qualified Data.IntSet                  as I
import           Numeric
import           Text.PrettyPrint.ANSI.Leijen

import           Blockchain.Data.Code
import           Blockchain.EVM.Opcodes
import           Blockchain.Util

import           Text.Format


getOperationAt::Code->CodePointer->(Operation, CodePointer)
getOperationAt (Code bytes) p        = opCode2Op bytes p

showCode::CodePointer->Code->String
showCode _ (Code bytes) | B.null bytes = ""
showCode lineNumber c@(Code rom) = showHex lineNumber "" ++ " " ++ format (B.pack $ op2OpCode op) ++ " " ++ show (pretty op) ++ "\n" ++  showCode (lineNumber + nextP) (Code (safeIntDrop nextP rom))
        where
          (op, nextP) = getOperationAt c 0

formatCode::Code->String
formatCode = showCode 0

getValidJUMPDESTs :: Code -> I.IntSet
getValidJUMPDESTs (Code bytes) = I.fromAscList $ go 0
 where
  len = B.length bytes
  go :: Int -> [Int]
  go !x = if x >= len
            then []
            else case B.index bytes x of
                    0x5b -> x : go (x+1)
                    op | 0x60 <= op && op <= 0x7f -> go (x + 2 + fromIntegral op - 0x60)
                       | otherwise -> go (x+1)

codeLength::Code->CodePointer
codeLength (Code bytes) = B.length bytes

compile::[Operation]->Code
compile x = Code bytes
  where
    bytes = B.pack $ op2OpCode =<< x
