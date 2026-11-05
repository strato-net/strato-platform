{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.VM.VMException
  ( VMException (..),
  )
where

import Blockchain.Strato.Model.Gas
import Control.DeepSeq
import Control.Exception
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import Data.Text (Text)
import qualified Data.Text as T
import Text.Format (format)
import GHC.Generics

data VMException
  = OutOfGasException
  | StackTooSmallException
  | VMException String
  | MalformedOpcodeException
  | DivByZeroException
  | InsufficientFunds
  | AddressDoesNotExist
  | StackTooLarge
  | CallStackTooDeep
  | InvalidJump
  | InvalidInstruction
  | WriteProtection
  | RevertException Gas ByteString
  | UnsupportedVM Text
  | NonDebugCallCreate
  deriving (Show, Eq, Generic, NFData)

instance Exception VMException where
  displayException OutOfGasException = "out of gas"
  displayException StackTooSmallException = "stack underflow"
  displayException (VMException message) = message
  displayException MalformedOpcodeException = "malformed opcode"
  displayException DivByZeroException = "division by zero"
  displayException InsufficientFunds = "insufficient funds"
  displayException AddressDoesNotExist = "address does not exist"
  displayException StackTooLarge = "stack overflow"
  displayException CallStackTooDeep = "call stack limit exceeded"
  displayException InvalidJump = "invalid jump destination"
  displayException InvalidInstruction = "invalid instruction"
  displayException WriteProtection = "write attempted during read-only execution"
  displayException (RevertException _ response) =
    "execution reverted" ++ if B.null response then "" else ": 0x" ++ format response
  displayException (UnsupportedVM name) = "unsupported VM: " ++ T.unpack name
  displayException NonDebugCallCreate = "call/create debugging is unavailable"
