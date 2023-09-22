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
import Data.Text (Text)
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
  deriving (Show, Eq, Exception, Generic, NFData)
