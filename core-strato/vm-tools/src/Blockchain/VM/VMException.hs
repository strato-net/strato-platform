module Blockchain.VM.VMException (
  VMException(..)
  ) where

import Control.DeepSeq
import Data.Text (Text)
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
  RevertException |
  UnsupportedVM Text deriving (Show, Eq, Generic, NFData)
