{-#
  LANGUAGE
    OverloadedStrings
  , RecordWildCards
#-}


module BlockApps.XAbiConverter where

import Data.Function
import Data.List
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Text (Text)

import BlockApps.Solidity
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import qualified BlockApps.Storage as Storage

--xabiFuncs=undefined
--xabiConstr=undefined
--xabiVars=undefined



fieldsToStruct::TypeDefs->[(Text, Type)]->Struct
fieldsToStruct typeDefs' vars =
  let
    (positionAfter, positions) = addPositions typeDefs' (Storage.positionAt 0)
                                 $ map snd vars
  in
   Struct {
     fields=Map.fromList
            $ zipWith (\(n, t) p -> (n, (p, t))) vars positions,
     size = fromIntegral $ 32 * Storage.offset positionAfter + fromIntegral (Storage.byte positionAfter)
     }


addPositions::TypeDefs->Storage.Position -> [Type] -> (Storage.Position, [Storage.Position])
addPositions _ p [] = (p, [])
addPositions typeDefs' p0 (theType:rest) =
  let
    (position, usedBytes) = getPositionAndSize typeDefs' p0 theType
  in
   fmap (position:) $ addPositions typeDefs' (Storage.addBytes position usedBytes) rest





xabiTypeToSimpleType::XabiType->SimpleType
xabiTypeToSimpleType XabiType{ xabiTypeType=Just "String" } = TypeString
xabiTypeToSimpleType XabiType{ xabiTypeType=Just "Address" } = TypeAddress

xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 1 } = TypeInt8
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 2 } = TypeInt16
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 3 } = TypeInt24
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 4 } = TypeInt32
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 5 } = TypeInt40
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 6 } = TypeInt48
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 7 } = TypeInt56
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 8 } = TypeInt64
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 9 } = TypeInt72
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 10 } = TypeInt80
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 11 } = TypeInt88
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 12 } = TypeInt96
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 13 } = TypeInt104
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 14 } = TypeInt112
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 15 } = TypeInt120
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 16 } = TypeInt128
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 17 } = TypeInt136
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 18 } = TypeInt144
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 19 } = TypeInt152
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 20 } = TypeInt160
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 21 } = TypeInt168
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 22 } = TypeInt176
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 23 } = TypeInt184
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 24 } = TypeInt192
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 25 } = TypeInt200
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 26 } = TypeInt208
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 27 } = TypeInt216
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 28 } = TypeInt224
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 29 } = TypeInt232
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 30 } = TypeInt240
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 31 } = TypeInt248
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 32 } = TypeInt256

xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 1 } = TypeUInt8
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 2 } = TypeUInt16
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 3 } = TypeUInt24
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 4 } = TypeUInt32
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 5 } = TypeUInt40
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 6 } = TypeUInt48
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 7 } = TypeUInt56
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 8 } = TypeUInt64
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 9 } = TypeUInt72
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 10 } = TypeUInt80
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 11 } = TypeUInt88
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 12 } = TypeUInt96
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 13 } = TypeUInt104
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 14 } = TypeUInt112
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 15 } = TypeUInt120
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 16 } = TypeUInt128
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 17 } = TypeUInt136
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 18 } = TypeUInt144
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 19 } = TypeUInt152
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 20 } = TypeUInt160
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 21 } = TypeUInt168
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 22 } = TypeUInt176
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 23 } = TypeUInt184
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 24 } = TypeUInt192
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 25 } = TypeUInt200
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 26 } = TypeUInt208
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 27 } = TypeUInt216
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 28 } = TypeUInt224
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 29 } = TypeUInt232
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 30 } = TypeUInt240
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 31 } = TypeUInt248
xabiTypeToSimpleType XabiType { xabiTypeType=Just "Int", xabiTypeBytes=Just 32 } = TypeUInt256

xabiTypeToSimpleType v = error $ "undefined var in varToSimpleType: " ++ show (xabiTypeType v) ++ ":" ++ show (xabiTypeBytes v)


xabiTypeToType::XabiType->Type
xabiTypeToType XabiType { xabiTypeType=Just "Array", xabiTypeLength=Just len, xabiTypeEntry=Just var } =
  TypeArrayFixed len $ xabiTypeToType var
xabiTypeToType XabiType { xabiTypeType=Just "Array", xabiTypeEntry=Just var } =
  TypeArrayDynamic $ xabiTypeToType var
xabiTypeToType XabiType { xabiTypeType=Just "Contract", xabiTypeTypedef=Just name } = TypeContract name
xabiTypeToType XabiType { xabiTypeType=Just "Mapping", xabiTypeKey=Just k, xabiTypeValue=Just v } = TypeMapping (xabiTypeToSimpleType k) (xabiTypeToType v)

xabiTypeToType XabiType { xabiTypeType=Just "Enum", xabiTypeTypedef=Just enumName } = TypeEnum enumName
xabiTypeToType v = SimpleType $ xabiTypeToSimpleType v

{-
varAsxabiType::Var->xabiType
varAsxabiType Var{varType=Just varType, varBytes=varBytes, varDynamic=varDynamic, varSigned=varSigned, varEntry=Nothing} =
  xabiType{
    xabiTypeType=varType,
    xabiTypeBytes=varBytes,
    xabiTypeDynamic=varDynamic,
    xabiTypeSigned=varSigned,
    xabiTypeEntry=Nothing
    }
varAsxabiType Var{varType=Just varType, varBytes=varBytes, varDynamic=varDynamic, varSigned=varSigned, varEntry=Just Var{varType=Just innerType, varBytes=Just innerBytes}} =
  xabiType{
    xabiTypeType=varType,
    xabiTypeBytes=varBytes,
    xabiTypeDynamic=varDynamic,
    xabiTypeSigned=varSigned,
    xabiTypeEntry=Just Entry{
      entryType=innerType,
      entryBytes=innerBytes
      }
    }
varAsxabiType x = error $ "Oops, varAsxabiType cannot convert " ++ show x
-}

getEnumDefs::Map Text VarType->Map Text EnumSet
getEnumDefs _ = Map.empty

xAbiToContract::Xabi->Contract
xAbiToContract Xabi{..} =
  let
    typeDefs' = TypeDefs{
      enumDefs=getEnumDefs xabiVars,
      structDefs=Map.fromList []
      }
  in
   Contract{
     mainStruct=
        fieldsToStruct typeDefs' $ map (fmap (xabiTypeToType . varTypeType)) $ sortBy (compare `on` (varTypeAtBytes . snd)) $ Map.toList xabiVars,
     typeDefs=typeDefs'
     }

