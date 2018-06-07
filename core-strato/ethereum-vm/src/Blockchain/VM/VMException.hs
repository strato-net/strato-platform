
module Blockchain.VM.VMException (
  VMException(..)
  ) where

data VMException =
  OutOfGasException |
  StackTooSmallException |
  VMException String |
  MalformedOpcodeException |
  DivByZeroException |
  InsufficientFunds |
  AddressDoesNotExist |
  StackTooLarge |
  CallStackTooDeep |
  InvalidJump |
  InvalidInstruction |
  WriteProtection |
  RevertException deriving (Show, Eq)

