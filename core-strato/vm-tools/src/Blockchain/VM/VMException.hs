module Blockchain.VM.VMException (
  VMException(..)
  ) where

import Control.DeepSeq
import GHC.Generics

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
  RevertException deriving (Show, Eq, Generic, NFData)
