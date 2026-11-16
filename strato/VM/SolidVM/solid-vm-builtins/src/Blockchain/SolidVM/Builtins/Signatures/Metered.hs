module Blockchain.SolidVM.Builtins.Signatures.Metered (ecrecover, verifyP256) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Signatures as Original
import qualified Data.ByteString as B
import Blockchain.Strato.Model.Address (Address)

ecrecover :: (MonadBuiltinGas m, Original.RecoverHash a) => a -> Integer -> Integer -> Integer -> m Address
ecrecover input v r s = chargeBuiltinGas 3000 >> pure (Original.ecrecover input v r s)
verifyP256 :: MonadBuiltinGas m => B.ByteString -> m (Either (Integer, Integer) B.ByteString) -> m (Integer, Integer) -> m Bool
verifyP256 digest key signature = chargeBuiltinGas 3000 >> Original.verifyP256 digest key signature
