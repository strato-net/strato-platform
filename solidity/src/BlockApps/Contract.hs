
module BlockApps.Contract where

import Data.Bimap (Bimap)
import qualified Data.Bimap as Bimap
import Data.Bits
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as T

import qualified BlockApps.Storage as Storage
import BlockApps.Types

type EnumSet = Bimap Int Text
type Enums = Map Text EnumSet

data Contract =
  Contract{
    storageVars::Map Text (Storage.Position, Type),
    enumDefs::Enums
    } deriving (Show)
  

getNextAvailablePosition::Storage.Position->Int->Storage.Position
getNextAvailablePosition p i | 32 - Storage.byte p >= i = p
getNextAvailablePosition p _ = p{Storage.offset=Storage.offset p+1, Storage.byte=0}

--Given the next available position, return the actual chosen position and the number of primary bytes used
getPositionAndSize::Enums->Storage.Position->Type->(Storage.Position, Int)
getPositionAndSize _ p TypeBool = (p,1)
getPositionAndSize _ p (TypeInt (Just v)) =
  let
    len = v `shiftR` 3
  in
   (getNextAvailablePosition p len, len)
getPositionAndSize _ p (TypeUInt (Just v)) =
  let
    len = v `shiftR` 3
  in
   (getNextAvailablePosition p len, len)
getPositionAndSize _ p TypeAddress = (getNextAvailablePosition p 20, 20)
getPositionAndSize _ p (TypeBytes Nothing) = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p TypeString = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p (TypeBytes (Just v)) = (getNextAvailablePosition p v, v)
getPositionAndSize enums p (TypeEnum name) =
  case Map.lookup name enums of
   Nothing -> error $ "Contract is using an enum that wasn't defined: " ++ T.unpack name ++ "\nenums is " ++ show enums
   Just enumset ->
     let len = Bimap.size enumset `shiftR` 8 + 1
     in (getNextAvailablePosition p len, len)
getPositionAndSize _ p _ = (p,32)
