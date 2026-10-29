{-# LANGUAGE FlexibleContexts #-}
module Blockchain.SolidVM.Builtins.Casts.Metered (int, decimal, address, string, bool, bytes, bytes32) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import Blockchain.SolidVM.Builtins.Casts (SolidInt, SolidDecimal, SolidAddress, SolidString, SolidBool, SolidBytes)
import qualified Blockchain.SolidVM.Builtins.Casts as Original
import Blockchain.SolidVM.Builtins.Size
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)
import Blockchain.Strato.Model.Address (Address)
import Data.Decimal (Decimal)
import qualified Data.Text as T
import qualified Data.ByteString as B

int :: (GasSize a, SolidInt a, MonadBuiltinGas m) => a -> m Integer
int value = invoke (gasSize value) (Original.int value)
decimal :: (GasSize a, SolidDecimal a, MonadBuiltinGas m) => a -> m Decimal
decimal value = invoke (gasSize value) (Original.decimal value)
address :: (GasSize a, SolidAddress a, MonadBuiltinGas m) => a -> m Address
address value = invoke (gasSize value) (Original.address value)
string :: (GasSize a, SolidString a, MonadBuiltinGas m) => a -> m T.Text
string value = invoke (gasSize value) (Original.string value)
bool :: (GasSize a, SolidBool a, MonadBuiltinGas m) => a -> m Bool
bool value = invoke (gasSize value) (Original.bool value)
bytes :: (GasSize a, SolidBytes a, MonadBuiltinGas m) => a -> m B.ByteString
bytes value = invoke (gasSize value) (Original.bytes value)

bytes32 :: MonadBuiltinGas m => Integer -> m B.ByteString
bytes32 value = invoke (gasSize value) (Original.bytes32 value)
