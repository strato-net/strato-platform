{-# LANGUAGE RecordWildCards #-}
module BlockApps.Solidity.Contract where

import qualified Data.Bimap                  as Bimap
import           Data.Bits
import           Network.Haskoin.Crypto
import qualified Data.Map                    as Map
import qualified Data.Text                   as T

import           BlockApps.Solidity.Struct   (Struct)
import qualified BlockApps.Solidity.Struct   as Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.TypeDefs
import qualified BlockApps.Storage           as Storage

data Contract = Contract { mainStruct :: Struct
                         , typeDefs   :: TypeDefs
                         } deriving (Show)


getNextAvailablePosition::Storage.Position->Word256->Storage.Position
getNextAvailablePosition p _ | Storage.byte p == 0 = p
getNextAvailablePosition p i | 32 - fromIntegral (Storage.byte p) >= i = p
getNextAvailablePosition p _ = p{Storage.offset=Storage.offset p+1, Storage.byte=0}

--Given the next available position, return the actual chosen position and the number of primary bytes used (this doesn't include bytes used at other memory locations, like the content of a large string)
getPositionAndSize::TypeDefs->Storage.Position->Type->(Storage.Position, Word256)
getPositionAndSize _ p (SimpleType TypeBool) = (p,1)

getPositionAndSize _ p (SimpleType TypeInt8)=(getNextAvailablePosition p 1, 1)
getPositionAndSize _ p (SimpleType TypeInt16)=(getNextAvailablePosition p 2, 2)
getPositionAndSize _ p (SimpleType TypeInt24)=(getNextAvailablePosition p 3, 3)
getPositionAndSize _ p (SimpleType TypeInt32)=(getNextAvailablePosition p 4, 4)
getPositionAndSize _ p (SimpleType TypeInt40)=(getNextAvailablePosition p 5, 5)
getPositionAndSize _ p (SimpleType TypeInt48)=(getNextAvailablePosition p 6, 6)
getPositionAndSize _ p (SimpleType TypeInt56)=(getNextAvailablePosition p 7, 7)
getPositionAndSize _ p (SimpleType TypeInt64)=(getNextAvailablePosition p 8, 8)

getPositionAndSize _ p (SimpleType TypeInt72)=(getNextAvailablePosition p 9, 9)
getPositionAndSize _ p (SimpleType TypeInt80)=(getNextAvailablePosition p 10, 10)
getPositionAndSize _ p (SimpleType TypeInt88)=(getNextAvailablePosition p 11, 11)
getPositionAndSize _ p (SimpleType TypeInt96)=(getNextAvailablePosition p 12, 12)
getPositionAndSize _ p (SimpleType TypeInt104)=(getNextAvailablePosition p 13, 13)
getPositionAndSize _ p (SimpleType TypeInt112)=(getNextAvailablePosition p 14, 14)
getPositionAndSize _ p (SimpleType TypeInt120)=(getNextAvailablePosition p 15, 15)
getPositionAndSize _ p (SimpleType TypeInt128)=(getNextAvailablePosition p 16, 16)

getPositionAndSize _ p (SimpleType TypeInt136)=(getNextAvailablePosition p 17, 17)
getPositionAndSize _ p (SimpleType TypeInt144)=(getNextAvailablePosition p 18, 18)
getPositionAndSize _ p (SimpleType TypeInt152)=(getNextAvailablePosition p 19, 19)
getPositionAndSize _ p (SimpleType TypeInt160)=(getNextAvailablePosition p 20, 20)
getPositionAndSize _ p (SimpleType TypeInt168)=(getNextAvailablePosition p 21, 21)
getPositionAndSize _ p (SimpleType TypeInt176)=(getNextAvailablePosition p 22, 22)
getPositionAndSize _ p (SimpleType TypeInt184)=(getNextAvailablePosition p 23, 23)
getPositionAndSize _ p (SimpleType TypeInt192)=(getNextAvailablePosition p 24, 24)

getPositionAndSize _ p (SimpleType TypeInt200)=(getNextAvailablePosition p 25, 25)
getPositionAndSize _ p (SimpleType TypeInt208)=(getNextAvailablePosition p 26, 26)
getPositionAndSize _ p (SimpleType TypeInt216)=(getNextAvailablePosition p 27, 27)
getPositionAndSize _ p (SimpleType TypeInt224)=(getNextAvailablePosition p 28, 28)
getPositionAndSize _ p (SimpleType TypeInt232)=(getNextAvailablePosition p 29, 29)
getPositionAndSize _ p (SimpleType TypeInt240)=(getNextAvailablePosition p 30, 30)
getPositionAndSize _ p (SimpleType TypeInt248)=(getNextAvailablePosition p 31, 31)
getPositionAndSize _ p (SimpleType TypeInt256)=(getNextAvailablePosition p 32, 32)



getPositionAndSize _ p (SimpleType TypeUInt8)=(getNextAvailablePosition p 1, 1)
getPositionAndSize _ p (SimpleType TypeUInt16)=(getNextAvailablePosition p 2, 2)
getPositionAndSize _ p (SimpleType TypeUInt24)=(getNextAvailablePosition p 3, 3)
getPositionAndSize _ p (SimpleType TypeUInt32)=(getNextAvailablePosition p 4, 4)
getPositionAndSize _ p (SimpleType TypeUInt40)=(getNextAvailablePosition p 5, 5)
getPositionAndSize _ p (SimpleType TypeUInt48)=(getNextAvailablePosition p 6, 6)
getPositionAndSize _ p (SimpleType TypeUInt56)=(getNextAvailablePosition p 7, 7)
getPositionAndSize _ p (SimpleType TypeUInt64)=(getNextAvailablePosition p 8, 8)

getPositionAndSize _ p (SimpleType TypeUInt72)=(getNextAvailablePosition p 9, 9)
getPositionAndSize _ p (SimpleType TypeUInt80)=(getNextAvailablePosition p 10, 10)
getPositionAndSize _ p (SimpleType TypeUInt88)=(getNextAvailablePosition p 11, 11)
getPositionAndSize _ p (SimpleType TypeUInt96)=(getNextAvailablePosition p 12, 12)
getPositionAndSize _ p (SimpleType TypeUInt104)=(getNextAvailablePosition p 13, 13)
getPositionAndSize _ p (SimpleType TypeUInt112)=(getNextAvailablePosition p 14, 14)
getPositionAndSize _ p (SimpleType TypeUInt120)=(getNextAvailablePosition p 15, 15)
getPositionAndSize _ p (SimpleType TypeUInt128)=(getNextAvailablePosition p 16, 16)

getPositionAndSize _ p (SimpleType TypeUInt136)=(getNextAvailablePosition p 17, 17)
getPositionAndSize _ p (SimpleType TypeUInt144)=(getNextAvailablePosition p 18, 18)
getPositionAndSize _ p (SimpleType TypeUInt152)=(getNextAvailablePosition p 19, 19)
getPositionAndSize _ p (SimpleType TypeUInt160)=(getNextAvailablePosition p 20, 20)
getPositionAndSize _ p (SimpleType TypeUInt168)=(getNextAvailablePosition p 21, 21)
getPositionAndSize _ p (SimpleType TypeUInt176)=(getNextAvailablePosition p 22, 22)
getPositionAndSize _ p (SimpleType TypeUInt184)=(getNextAvailablePosition p 23, 23)
getPositionAndSize _ p (SimpleType TypeUInt192)=(getNextAvailablePosition p 24, 24)

getPositionAndSize _ p (SimpleType TypeUInt200)=(getNextAvailablePosition p 25, 25)
getPositionAndSize _ p (SimpleType TypeUInt208)=(getNextAvailablePosition p 26, 26)
getPositionAndSize _ p (SimpleType TypeUInt216)=(getNextAvailablePosition p 27, 27)
getPositionAndSize _ p (SimpleType TypeUInt224)=(getNextAvailablePosition p 28, 28)
getPositionAndSize _ p (SimpleType TypeUInt232)=(getNextAvailablePosition p 29, 29)
getPositionAndSize _ p (SimpleType TypeUInt240)=(getNextAvailablePosition p 30, 30)
getPositionAndSize _ p (SimpleType TypeUInt248)=(getNextAvailablePosition p 31, 31)
getPositionAndSize _ p (SimpleType TypeUInt256)=(getNextAvailablePosition p 32, 32)




getPositionAndSize _ p (SimpleType TypeInt)=(getNextAvailablePosition p 32, 32)
getPositionAndSize _ p (SimpleType TypeUInt)=(getNextAvailablePosition p 32, 32)









getPositionAndSize _ p (SimpleType TypeAddress)=(getNextAvailablePosition p 20, 20)
getPositionAndSize _ p (SimpleType TypeBytes) = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p (SimpleType TypeString) = (getNextAvailablePosition p 32, 32)


getPositionAndSize _ p (SimpleType TypeBytes1) = (getNextAvailablePosition p 1, 1)
getPositionAndSize _ p (SimpleType TypeBytes2) = (getNextAvailablePosition p 2, 2)
getPositionAndSize _ p (SimpleType TypeBytes3) = (getNextAvailablePosition p 3, 3)
getPositionAndSize _ p (SimpleType TypeBytes4) = (getNextAvailablePosition p 4, 4)
getPositionAndSize _ p (SimpleType TypeBytes5) = (getNextAvailablePosition p 5, 5)
getPositionAndSize _ p (SimpleType TypeBytes6) = (getNextAvailablePosition p 6, 6)
getPositionAndSize _ p (SimpleType TypeBytes7) = (getNextAvailablePosition p 7, 7)
getPositionAndSize _ p (SimpleType TypeBytes8) = (getNextAvailablePosition p 8, 8)

getPositionAndSize _ p (SimpleType TypeBytes9) = (getNextAvailablePosition p 9, 9)
getPositionAndSize _ p (SimpleType TypeBytes10) = (getNextAvailablePosition p 10, 10)
getPositionAndSize _ p (SimpleType TypeBytes11) = (getNextAvailablePosition p 11, 11)
getPositionAndSize _ p (SimpleType TypeBytes12) = (getNextAvailablePosition p 12, 12)
getPositionAndSize _ p (SimpleType TypeBytes13) = (getNextAvailablePosition p 13, 13)
getPositionAndSize _ p (SimpleType TypeBytes14) = (getNextAvailablePosition p 14, 14)
getPositionAndSize _ p (SimpleType TypeBytes15) = (getNextAvailablePosition p 15, 15)
getPositionAndSize _ p (SimpleType TypeBytes16) = (getNextAvailablePosition p 16, 16)

getPositionAndSize _ p (SimpleType TypeBytes17) = (getNextAvailablePosition p 17, 17)
getPositionAndSize _ p (SimpleType TypeBytes18) = (getNextAvailablePosition p 18, 18)
getPositionAndSize _ p (SimpleType TypeBytes19) = (getNextAvailablePosition p 19, 19)
getPositionAndSize _ p (SimpleType TypeBytes20) = (getNextAvailablePosition p 20, 20)
getPositionAndSize _ p (SimpleType TypeBytes21) = (getNextAvailablePosition p 21, 21)
getPositionAndSize _ p (SimpleType TypeBytes22) = (getNextAvailablePosition p 22, 22)
getPositionAndSize _ p (SimpleType TypeBytes23) = (getNextAvailablePosition p 23, 23)
getPositionAndSize _ p (SimpleType TypeBytes24) = (getNextAvailablePosition p 24, 24)

getPositionAndSize _ p (SimpleType TypeBytes25) = (getNextAvailablePosition p 25, 25)
getPositionAndSize _ p (SimpleType TypeBytes26) = (getNextAvailablePosition p 26, 26)
getPositionAndSize _ p (SimpleType TypeBytes27) = (getNextAvailablePosition p 27, 27)
getPositionAndSize _ p (SimpleType TypeBytes28) = (getNextAvailablePosition p 28, 28)
getPositionAndSize _ p (SimpleType TypeBytes29) = (getNextAvailablePosition p 29, 29)
getPositionAndSize _ p (SimpleType TypeBytes30) = (getNextAvailablePosition p 30, 30)
getPositionAndSize _ p (SimpleType TypeBytes31) = (getNextAvailablePosition p 31, 31)
getPositionAndSize _ p (SimpleType TypeBytes32) = (getNextAvailablePosition p 32, 32)




getPositionAndSize TypeDefs{..} p (TypeEnum name) =
  case Map.lookup name enumDefs of
   Nothing -> error $ "Contract is using an enum that wasn't defined: " ++ T.unpack name ++ "\nenums is " ++ show enumDefs
   Just enumset ->
     let len = fromIntegral $ Bimap.size enumset `shiftR` 8 + 1
     in (getNextAvailablePosition p len, len)

getPositionAndSize TypeDefs{..} p (TypeStruct name) =
  case Map.lookup name structDefs of
   Nothing -> error $ "Contract is using an struct that wasn't defined: " ++ T.unpack name ++ "\nstructs is " ++ show structDefs
   Just struct -> nextAvail p $ Struct.size struct

getPositionAndSize _ p (TypeArrayDynamic _) = (getNextAvailablePosition p 32, 32)
getPositionAndSize typeDefs' p (TypeArrayFixed size ty) =
  let
    (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
    itemsPerWord = 32 `quot` elementSize
    divRoundUp x y =
      let
        (d, r) = x `quotRem` y
      in
       if r == 0
       then d
       else d+1
  in
   (p, fromIntegral $ 32*size `divRoundUp` fromIntegral itemsPerWord)
getPositionAndSize _ p TypeMapping{}  = (getNextAvailablePosition p 32, 32)
getPositionAndSize _ p TypeFunction{} = (p,32)
getPositionAndSize _ p TypeContract{} = nextAvail p 20

nextAvail::Storage.Position->Word256->(Storage.Position, Word256)
nextAvail p x = (getNextAvailablePosition p x, x)

--getPositionAndSize _ p _ = (p,32)
