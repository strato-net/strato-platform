{-# LANGUAGE DataKinds #-}
{-# LANGUAGE KindSignatures #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeSynonymInstances #-}
module Blockchain.SolidVM.Builtins.Size
  ( GasSize (gasSize), FunctionArguments (argumentWords), TupleSize (tupleSize), ArraySlots (..), slotSize, variadicSize, wordsFor ) where

import Blockchain.SolidVM.Builtins.Gas (byteWidth)
import Blockchain.Strato.Model.Address (Address)
import qualified Data.ByteString as B
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import qualified Data.Sequence as Seq
import Data.Kind (Type)
import Data.Proxy (Proxy (..))
import SolidVM.Model.Storable (StoragePath)
import Data.Decimal (Decimal, decimalMantissa)

class GasSize a where
  gasSize :: a -> Integer

instance GasSize Integer where gasSize = max 32 . byteWidth
instance GasSize Int where gasSize = const 32
instance GasSize Bool where gasSize = const 32
instance GasSize Address where gasSize = const 32
instance GasSize Decimal where gasSize = max 32 . byteWidth . decimalMantissa
instance GasSize () where gasSize = const 0
instance GasSize B.ByteString where gasSize = fromIntegral . B.length
instance GasSize T.Text where gasSize = fromIntegral . B.length . T.encodeUtf8
instance GasSize String where gasSize = gasSize . T.pack
instance GasSize a => GasSize (Maybe a) where gasSize = maybe 0 gasSize
instance (GasSize a, GasSize b) => GasSize (a,b) where gasSize (a,b) = gasSize a + gasSize b
instance (GasSize a, GasSize b, GasSize c) => GasSize (a,b,c) where gasSize (a,b,c) = gasSize a + gasSize b + gasSize c

wordsFor :: Integer -> Integer
wordsFor bytes = (max 0 bytes + 31) `div` 32

slotSize :: a -> Integer
slotSize = const 32

variadicSize :: GasSize a => [a] -> Integer
variadicSize = sum . map gasSize

newtype ArraySlots a = ArraySlots [a]
instance GasSize (ArraySlots a) where gasSize (ArraySlots values) = slotSize () * fromIntegral (length values)
instance GasSize (Seq.Seq a) where gasSize = (slotSize () *) . fromIntegral . Seq.length
instance GasSize StoragePath where gasSize = slotSize
instance GasSize (Either StoragePath a) where gasSize = slotSize

class TupleSize (ts :: [Type]) where
  tupleSize :: proxy ts -> Integer
instance TupleSize '[] where tupleSize _ = 0
instance TupleSize ts => TupleSize (a ': ts) where
  tupleSize _ = slotSize () + tupleSize (Proxy :: Proxy ts)

class FunctionArguments args where
  argumentWords :: args -> Integer
instance FunctionArguments () where argumentWords _ = 0
instance (GasSize a, FunctionArguments rest) => FunctionArguments (a, rest) where
  argumentWords (value, rest) = wordsFor (gasSize value) + argumentWords rest
