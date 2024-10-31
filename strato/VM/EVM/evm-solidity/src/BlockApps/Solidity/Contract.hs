{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}

module BlockApps.Solidity.Contract where

import BlockApps.Solidity.Struct (Struct)
import qualified BlockApps.Solidity.Struct as Struct
import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import qualified BlockApps.Storage as Storage
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq
import qualified Data.Bimap as Bimap
import Data.Bits
import qualified Data.Map as Map
import qualified Data.Text as T
import GHC.Generics

data Contract = Contract
  { mainStruct :: Struct,
    typeDefs :: TypeDefs
  }
  deriving (Show, Generic, NFData)

getNextAvailablePosition :: Storage.Position -> Integer -> Storage.Position
getNextAvailablePosition p _ | Storage.byte p == 0 = p
getNextAvailablePosition p i | 32 - fromIntegral (Storage.byte p) >= i = p
getNextAvailablePosition p _ = p {Storage.offset = Storage.offset p + 1, Storage.byte = 0}

--Given the next available position, return the actual chosen position and the number of primary bytes used (this doesn't include bytes used at other memory locations, like the content of a large string)
getPositionAndSize :: TypeDefs -> Storage.Position -> Type -> (Storage.Position, Word256)
getPositionAndSize _ p (SimpleType TypeBool) = (getNextAvailablePosition p 1, 1)
getPositionAndSize _ p (SimpleType (TypeInt _ (Just b))) = (getNextAvailablePosition p b, fromInteger b)
getPositionAndSize _ p (SimpleType (TypeInt _ Nothing)) = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p (SimpleType TypeAddress) = (getNextAvailablePosition p 20, 20)
getPositionAndSize _ p (SimpleType TypeAccount) = (getNextAvailablePosition p 20, 20)
getPositionAndSize _ p (SimpleType (TypeBytes (Just b))) = (getNextAvailablePosition p b, fromInteger b)
getPositionAndSize _ p (SimpleType (TypeBytes Nothing)) = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p (SimpleType TypeString) = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p (SimpleType TypeDecimal) = (getNextAvailablePosition p 32, 32)
getPositionAndSize TypeDefs {..} p (TypeEnum name) =
  case Map.lookup name enumDefs of
    Nothing -> error $ "Contract is using an enum that wasn't defined: " ++ T.unpack name ++ "\nenums is " ++ show enumDefs
    Just enumset ->
      let len = toInteger $ (Bimap.size enumset `shiftR` 8) + 1
       in (getNextAvailablePosition p len, fromInteger len)
getPositionAndSize TypeDefs {..} p (TypeStruct name) =
  case Map.lookup name structDefs of
    Nothing -> error $ "Contract is using an struct that wasn't defined: " ++ T.unpack name ++ "\nstructs is " ++ show structDefs
    Just struct -> nextAvail p $ Struct.size struct
getPositionAndSize _ p (TypeArrayDynamic _) = (getNextAvailablePosition p 32, 32)
getPositionAndSize typeDefs' p (TypeArrayFixed size ty) =
  let (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      itemsPerWord = 32 `quot` elementSize
      divRoundUp x y =
        let (d, r) = x `quotRem` y
         in if r == 0
              then d
              else d + 1
   in (p, fromIntegral $ 32 * size `divRoundUp` fromIntegral itemsPerWord)
getPositionAndSize _ p TypeMapping {} = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p TypeFunction {} = (p, 32)
getPositionAndSize _ p TypeContract {} = nextAvail p 20
getPositionAndSize _ p TypeVariadic {} = (getNextAvailablePosition p 32, 32)

nextAvail :: Storage.Position -> Word256 -> (Storage.Position, Word256)
nextAvail p x = (getNextAvailablePosition p $ toInteger x, x)

--getPositionAndSize _ p _ = (p,32)
