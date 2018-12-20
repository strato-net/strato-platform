{-# LANGUAGE BangPatterns #-}
module Blockchain.VM.Code where

import qualified Data.ByteString              as B
import qualified Data.IntSet                  as I
-- import           Numeric
-- import           Text.PrettyPrint.ANSI.Leijen

-- import qualified Blockchain.Colors            as CL
import           Blockchain.Data.Code
-- import           Blockchain.Format
-- import           Blockchain.Util
import           Blockchain.VM.Opcodes


{-# INLINE getOperationAt #-}
getOperationAt::Code->CodePointer-> Operation
getOperationAt (Code bytes) p        = if p >= B.length bytes then STOP else toEnum . fromIntegral $ B.index bytes p
getOperationAt (PrecompiledCode _) _ = error "getOperationAt called for precompiled code"

-- TODO(tim): showCode
showCode :: CodePointer -> Code -> String
showCode = error "TODO(tim): showCode"
-- showCode::CodePointer->Code->String
-- showCode _ (Code bytes) | B.null bytes = ""
-- showCode _ (PrecompiledCode x) = CL.blue $ "<PrecompiledCode:" ++ show x ++">"
-- showCode lineNumber c@(Code rom) = showHex lineNumber "" ++ " " ++ format (B.pack $ op2OpCode op) ++ " " ++ show (pretty op) ++ "\n" ++  showCode (lineNumber + nextP) (Code (safeIntDrop nextP rom))
--         where
--           (op, nextP) = getOperationAt c 0

-- formatCode::Code->String
-- formatCode = showCode 0

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

codeLength::Code->CodePointer
codeLength (Code bytes)        = B.length bytes
codeLength (PrecompiledCode _) = error "codeLength called on precompiled code"
