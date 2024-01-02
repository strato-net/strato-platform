{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE MagicHash #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.EVM.Opcodes where

import Blockchain.Strato.Model.ExtendedWord
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Unsafe as BU
import Data.Data
import qualified Data.Map as M
import Data.Maybe
import Data.Primitive.ByteArray
import Foreign.Ptr
import Foreign.Storable
import GHC.Exts hiding (LT,GT, EQ)
import GHC.Num.BigNat
import GHC.Num.Integer
import GHC.Word
import Network.Haskoin.Crypto.BigWord (BigWord (..))
import System.Endian
import System.IO.Unsafe
import Text.Format

import Prelude hiding (EQ, GT, LT)

type CodePointer = Int

data Operation
  = STOP
  | ADD
  | MUL
  | SUB
  | DIV
  | SDIV
  | MOD
  | SMOD
  | ADDMOD
  | MULMOD
  | EXP
  | SIGNEXTEND
  | NEG
  | LT
  | GT
  | SLT
  | SGT
  | EQ
  | ISZERO
  | NOT
  | AND
  | OR
  | XOR
  | BYTE
  | SHL
  | SHR
  | SAR
  | SHA3
  | ADDRESS
  | BALANCE
  | ORIGIN
  | CALLER
  | CALLVALUE
  | CALLDATALOAD
  | CALLDATASIZE
  | CALLDATACOPY
  | CODESIZE
  | CODECOPY
  | GASPRICE
  | EXTCODESIZE
  | EXTCODECOPY
  | RETURNDATASIZE
  | RETURNDATACOPY
  | BLOCKHASH
  | COINBASE
  | TIMESTAMP
  | NUMBER
  | DIFFICULTY
  | GASLIMIT
  | POP
  | MLOAD
  | MSTORE
  | MSTORE8
  | SLOAD
  | SSTORE
  | JUMP
  | JUMPI
  | PC
  | MSIZE
  | GAS
  | JUMPDEST
  | PUSH Word256
  | DUP1
  | DUP2
  | DUP3
  | DUP4
  | DUP5
  | DUP6
  | DUP7
  | DUP8
  | DUP9
  | DUP10
  | DUP11
  | DUP12
  | DUP13
  | DUP14
  | DUP15
  | DUP16
  | SWAP1
  | SWAP2
  | SWAP3
  | SWAP4
  | SWAP5
  | SWAP6
  | SWAP7
  | SWAP8
  | SWAP9
  | SWAP10
  | SWAP11
  | SWAP12
  | SWAP13
  | SWAP14
  | SWAP15
  | SWAP16
  | LOG0
  | LOG1
  | LOG2
  | LOG3
  | LOG4
  | CREATE
  | CALL
  | CALLCODE
  | RETURN
  | DELEGATECALL
  | STATICCALL
  | REVERT
  | INVALID
  | SUICIDE
  | --Pseudo Opcodes
    LABEL String
  | PUSHLABEL String
  | PUSHDIFF String String
  | DATA B.ByteString
  | MalformedOpcode Word8
  deriving (Show, Eq, Ord, Typeable, Data)

instance Format Operation where
  format x@JUMPDEST = "------" ++ show x
  format (PUSH v) = "PUSH " ++ show v
  format x = show x

data OPData = OPData Word8 Operation Int Int String

type EthCode = [Operation]

singleOp :: Operation -> ([Word8] -> Operation, Int)
singleOp o = (const o, 1)

opDatas :: [OPData]
opDatas =
  [ OPData 0x00 STOP 0 0 "Halts execution.",
    OPData 0x01 ADD 2 1 "Addition operation.",
    OPData 0x02 MUL 2 1 "Multiplication operation.",
    OPData 0x03 SUB 2 1 "Subtraction operation.",
    OPData 0x04 DIV 2 1 "Integer division operation.",
    OPData 0x05 SDIV 2 1 "Signed integer division operation.",
    OPData 0x06 MOD 2 1 "Modulo remainder operation.",
    OPData 0x07 SMOD 2 1 "Signed modulo remainder operation.",
    OPData 0x08 ADDMOD 2 1 "unsigned modular addition",
    OPData 0x09 MULMOD 2 1 "unsigned modular multiplication",
    OPData 0x0a EXP 2 1 "Exponential operation.",
    OPData 0x0b SIGNEXTEND 2 1 "Extend length of two’s complement signed integer.",
    OPData 0x10 LT 2 1 "Less-than comparision.",
    OPData 0x11 GT 2 1 "Greater-than comparision.",
    OPData 0x12 SLT 2 1 "Signed less-than comparision.",
    OPData 0x13 SGT 2 1 "Signed greater-than comparision.",
    OPData 0x14 EQ 2 1 "Equality comparision.",
    OPData 0x15 ISZERO 1 1 "Simple not operator.",
    OPData 0x16 AND 2 1 "Bitwise AND operation.",
    OPData 0x17 OR 2 1 "Bitwise OR operation.",
    OPData 0x18 XOR 2 1 "Bitwise XOR operation.",
    OPData 0x19 NOT 1 1 "Bitwise not operator.",
    OPData 0x1a BYTE 2 1 "Retrieve single byte from word.",
    OPData 0x1b SHL 2 1 "Bitwise left shift.",
    OPData 0x1c SHR 2 1 "Logical bitwise right shift.",
    OPData 0x1d SAR 2 1 "Arithmetic bitwise right shift.",
    OPData 0x20 SHA3 2 1 "Compute SHA3-256 hash.",
    OPData 0x30 ADDRESS 0 1 "Get address of currently executing account.",
    OPData 0x31 BALANCE 1 1 "Get balance of the given account.",
    OPData 0x32 ORIGIN 0 1 "Get execution origination address.",
    OPData 0x33 CALLER 0 1 "Get caller address.",
    OPData 0x34 CALLVALUE 0 1 "Get deposited value by the instruction/transaction responsible for this execution.",
    OPData 0x35 CALLDATALOAD 1 1 "Get input data of current environment.",
    OPData 0x36 CALLDATASIZE 0 1 "Get size of input data in current environment.",
    OPData 0x37 CALLDATACOPY 3 0 "Copy input data in current environment to memory.",
    OPData 0x38 CODESIZE 0 1 "Get size of code running in current environment.",
    OPData 0x39 CODECOPY 3 0 "Copy code running in current environment to memory.",
    OPData 0x3a GASPRICE 0 1 "Get price of gas in current environment.",
    OPData 0x3b EXTCODESIZE 0 1 "Get size of an account's code.",
    OPData 0x3c EXTCODECOPY 0 4 "Copy an account’s code to memory",
    OPData
      0x3d
      RETURNDATASIZE
      0
      1
      "Get size of output data from previous call\
      \ from the current environment",
    OPData 0x3e RETURNDATACOPY 3 0 "Copy output data from the previous call to memory.",
    OPData 0x40 BLOCKHASH 0 1 "Get hash of most recent complete block.",
    OPData 0x41 COINBASE 0 1 "Get the block’s coinbase address.",
    OPData 0x42 TIMESTAMP 0 1 "Get the block’s timestamp.",
    OPData 0x43 NUMBER 0 1 "Get the block’s number.",
    OPData 0x44 DIFFICULTY 0 1 "Get the block’s difficulty.",
    OPData 0x45 GASLIMIT 0 1 "Get the block’s gas limit.",
    OPData 0x50 POP 1 0 "Remove item from stack.",
    OPData 0x51 MLOAD 1 1 "Load word from memory.",
    OPData 0x52 MSTORE 2 0 "Save word to memory.",
    OPData 0x53 MSTORE8 2 0 "Save byte to memory.",
    OPData 0x54 SLOAD 1 1 "Load word from storage.",
    OPData 0x55 SSTORE 2 0 "Save word to storage.",
    OPData 0x56 JUMP 1 0 "Alter the program counter.",
    OPData 0x57 JUMPI 2 0 "Conditionally alter the program counter.",
    OPData 0x58 PC 0 1 "Get the program counter.",
    OPData 0x59 MSIZE 0 1 "Get the size of active memory in bytes.",
    OPData 0x5a GAS 0 1 "Get the amount of available gas.",
    OPData 0x5b JUMPDEST 0 0 "set a potential jump destination",
    OPData 0x80 DUP1 1 2 "Duplicate 1st stack item.",
    OPData 0x81 DUP2 2 3 "Duplicate 2nd stack item.",
    OPData 0x82 DUP3 3 4 "Duplicate 3rd stack item.",
    OPData 0x83 DUP4 4 5 "Duplicate 4th stack item.",
    OPData 0x84 DUP5 5 6 "Duplicate 5th stack item.",
    OPData 0x85 DUP6 6 7 "Duplicate 6th stack item.",
    OPData 0x86 DUP7 7 8 "Duplicate 7th stack item.",
    OPData 0x87 DUP8 8 9 "Duplicate 8th stack item.",
    OPData 0x88 DUP9 9 10 "Duplicate 9th stack item.",
    OPData 0x89 DUP10 10 11 "Duplicate 10th stack item.",
    OPData 0x8a DUP11 11 12 "Duplicate 11th stack item.",
    OPData 0x8b DUP12 12 13 "Duplicate 12th stack item.",
    OPData 0x8c DUP13 13 14 "Duplicate 13th stack item.",
    OPData 0x8d DUP14 14 15 "Duplicate 14th stack item.",
    OPData 0x8e DUP15 15 16 "Duplicate 15th stack item.",
    OPData 0x8f DUP16 16 17 "Duplicate 16th stack item.",
    OPData 0x90 SWAP1 2 2 "Exchange 1st and 2nd stack items.",
    OPData 0x91 SWAP2 3 3 "Exchange 1st and 3nd stack items.",
    OPData 0x92 SWAP3 4 4 "Exchange 1st and 4nd stack items.",
    OPData 0x93 SWAP4 5 5 "Exchange 1st and 5nd stack items.",
    OPData 0x94 SWAP5 6 6 "Exchange 1st and 6nd stack items.",
    OPData 0x95 SWAP6 7 7 "Exchange 1st and 7nd stack items.",
    OPData 0x96 SWAP7 8 8 "Exchange 1st and 8nd stack items.",
    OPData 0x97 SWAP8 9 9 "Exchange 1st and 9nd stack items.",
    OPData 0x98 SWAP9 10 10 "Exchange 1st and 10nd stack items.",
    OPData 0x99 SWAP10 11 11 "Exchange 1st and 11nd stack items.",
    OPData 0x9a SWAP11 12 12 "Exchange 1st and 12nd stack items.",
    OPData 0x9b SWAP12 13 13 "Exchange 1st and 13nd stack items.",
    OPData 0x9c SWAP13 14 14 "Exchange 1st and 14nd stack items.",
    OPData 0x9d SWAP14 15 15 "Exchange 1st and 15nd stack items.",
    OPData 0x9e SWAP15 16 16 "Exchange 1st and 16nd stack items.",
    OPData 0x9f SWAP16 17 17 "Exchange 1st and 17nd stack items.",
    OPData 0xa0 LOG0 2 0 "Append log record with no topics.",
    OPData 0xa1 LOG1 3 0 "Append log record with one topic.",
    OPData 0xa2 LOG2 4 0 "Append log record with two topics.",
    OPData 0xa3 LOG3 5 0 "Append log record with three topics.",
    OPData 0xa4 LOG4 6 0 "Append log record with four topics.",
    OPData 0xf0 CREATE 3 1 "Create a new account with associated code.",
    OPData 0xf1 CALL 7 1 "Message-call into an account.",
    OPData 0xf2 CALLCODE 7 1 "Message-call into this account with alternate account's code.",
    OPData 0xf3 RETURN 2 0 "Halt execution returning output data.",
    OPData 0xf4 DELEGATECALL 6 1 "Message-call into this account with an alternative account’s code, but persisting the current values for sender and value.",
    OPData
      0xfa
      STATICCALL
      6
      1
      "Static message-call into an account. Attempted storage writes\
      \ will throw an exception.",
    OPData
      0xfd
      REVERT
      2
      0
      "Halt execution reverting state changes but returning data and\
      \ remaining gas.",
    -- These α and δ are technically ∅, but rather than risk an undefined exception set to 0.
    OPData 0xfe INVALID 0 0 "Designated invalid instruction",
    OPData 0xff SUICIDE 1 0 "Halt execution and register account for later deletion."
  ]

op2CodeMap :: M.Map Operation Word8
op2CodeMap = M.fromList $ (\(OPData code op _ _ _) -> (op, code)) <$> opDatas

code2OpMap :: M.Map Word8 Operation
code2OpMap = M.fromList $ (\(OPData opcode op _ _ _) -> (opcode, op)) <$> opDatas

op2OpCode :: Operation -> [Word8]
-- This preserves semantics, but it will print a different opcode than was actually in the code
op2OpCode (PUSH v) = 0x7f : B.unpack (word256ToBytes v)
op2OpCode (DATA bytes) = B.unpack bytes
op2OpCode (MalformedOpcode byte) = [byte]
op2OpCode op =
  case M.lookup op op2CodeMap of
    Just x -> [x]
    Nothing -> error $ "op is missing in op2CodeMap: " ++ show op

opCode2Op :: B.ByteString -> Int -> (Operation, CodePointer)
opCode2Op rom !idx | idx >= B.length rom = (STOP, 1) --according to the yellowpaper, should return STOP if outside of the code bytestring
opCode2Op rom !idx =
  let opcode = BU.unsafeIndex rom idx
   in if opcode < 0x60 || opcode > 0x7f
        then (,1) . fromMaybe (MalformedOpcode opcode) . M.lookup opcode $ code2OpMap
        else case fromIntegral (opcode - 0x5f) of
          1 -> (PUSH $! fastExtractByte rom (idx + 1), 2)
          len
            | len <= 7 -> (PUSH $! fastExtractSingle rom (idx + 1) len, len + 1)
            | len >= 25 -> (PUSH $! fastExtractQuad rom (idx + 1) len, len + 1)
            | otherwise -> (PUSH $! defaultExtract rom (idx + 1) len, len + 1)

-- Unoptimized extraction, for 8-24 bytes that are too infrequently seen
-- to bother writing a specialization.
defaultExtract :: B.ByteString -> Int -> Int -> Word256
defaultExtract bs off len =
  let slice = B.take len . B.drop off $ bs
   in bytesToWord256 $ B.replicate (32 - B.length slice) 0x0 <> slice

-- Used to push 1 byte
fastExtractByte :: B.ByteString -> Int -> Word256
fastExtractByte !code !off =
  let !byte = BU.unsafeIndex code off
   in BigWord (fromIntegral byte)

-- Used to push 2-7 bytes
fastExtractSingle :: B.ByteString -> Int -> Int -> Word256
fastExtractSingle !code !off !len = unsafePerformIO . BU.unsafeUseAsCString code $ \ptr -> do
  let !offPtr = castPtr ptr :: Ptr Word64
      !delta = 64 - (8 * len)
  -- This may read past the end of the bytestring, but if the read is allowed
  -- those garbage bytes are truncated by the shift.
  !rawBits <- peekByteOff offPtr off
  let !(W64# w#) = toBE64 rawBits `shiftR` delta
  return $! BigWord (IS (word2Int# (word64ToWord# w#)))

-- Used to push 25-32 bytes
fastExtractQuad :: B.ByteString -> Int -> Int -> Word256
fastExtractQuad !code !off !len = unsafePerformIO . BU.unsafeUseAsCString code $ \ptr -> do
  let !offPtr = castPtr (plusPtr ptr (off + len)) :: Ptr Word64
  !dst <- newByteArray 32
  fillByteArray dst 0 32 0x0
  !ll <- peekElemOff offPtr (-1)
  !lh <- peekElemOff offPtr (-2)
  !hl <- peekElemOff offPtr (-3)
  -- This might be a violation: we read before the beginning of the bytestring.
  -- However if the read is allowed, the garbage bytes are masked off.
  !hh <- peekElemOff offPtr (-4)

  writeByteArray dst 0 $! toBE64 ll
  writeByteArray dst 1 $! toBE64 lh
  writeByteArray dst 2 $! toBE64 hl
  let !mask = bit (8 * (len - 24)) - 1
  writeByteArray dst 3 $! toBE64 hh .&. mask
  !(ByteArray ba#) <- unsafeFreezeByteArray dst
  return (BigWord (IP (unBigNat (BN# ba#))))
