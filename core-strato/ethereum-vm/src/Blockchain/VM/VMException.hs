
module Blockchain.VM.VMException (
  VMException(..)
  ) where

import Control.DeepSeq

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

instance NFData VMException where
  rnf = flip seq ()
