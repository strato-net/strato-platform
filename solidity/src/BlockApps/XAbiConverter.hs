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





simplevarToSimpleType::SimpleVar->SimpleType
simplevarToSimpleType SimpleVar { simplevarType="String" } = TypeString
simplevarToSimpleType SimpleVar { simplevarType="Address" } = TypeAddress

simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 1 } = TypeInt8
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 2 } = TypeInt16
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 3 } = TypeInt24
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 4 } = TypeInt32
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 5 } = TypeInt40
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 6 } = TypeInt48
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 7 } = TypeInt56
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 8 } = TypeInt64
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 9 } = TypeInt72
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 10 } = TypeInt80
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 11 } = TypeInt88
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 12 } = TypeInt96
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 13 } = TypeInt104
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 14 } = TypeInt112
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 15 } = TypeInt120
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 16 } = TypeInt128
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 17 } = TypeInt136
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 18 } = TypeInt144
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 19 } = TypeInt152
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 20 } = TypeInt160
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 21 } = TypeInt168
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 22 } = TypeInt176
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 23 } = TypeInt184
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 24 } = TypeInt192
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 25 } = TypeInt200
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 26 } = TypeInt208
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 27 } = TypeInt216
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 28 } = TypeInt224
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 29 } = TypeInt232
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 30 } = TypeInt240
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 31 } = TypeInt248
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarSigned=Just True, simplevarBytes=Just 32 } = TypeInt256

simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 1 } = TypeUInt8
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 2 } = TypeUInt16
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 3 } = TypeUInt24
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 4 } = TypeUInt32
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 5 } = TypeUInt40
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 6 } = TypeUInt48
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 7 } = TypeUInt56
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 8 } = TypeUInt64
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 9 } = TypeUInt72
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 10 } = TypeUInt80
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 11 } = TypeUInt88
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 12 } = TypeUInt96
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 13 } = TypeUInt104
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 14 } = TypeUInt112
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 15 } = TypeUInt120
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 16 } = TypeUInt128
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 17 } = TypeUInt136
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 18 } = TypeUInt144
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 19 } = TypeUInt152
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 20 } = TypeUInt160
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 21 } = TypeUInt168
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 22 } = TypeUInt176
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 23 } = TypeUInt184
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 24 } = TypeUInt192
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 25 } = TypeUInt200
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 26 } = TypeUInt208
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 27 } = TypeUInt216
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 28 } = TypeUInt224
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 29 } = TypeUInt232
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 30 } = TypeUInt240
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 31 } = TypeUInt248
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 32 } = TypeUInt256

simplevarToSimpleType v = error $ "undefined var in varToSimpleType: " ++ show (simplevarType v) ++ ":" ++ show (simplevarBytes v)




varToType::Var->Type
varToType Var { varType=Just "Array", varLength=Just len, varEntry=Just var } =
  TypeArrayFixed len $ varToType var
varToType Var { varType=Just "Array", varEntry=Just var } =
  TypeArrayDynamic $ varToType var




varToType Var { varType=Just "Contract", varTypedef=Just name } = TypeContract name
varToType Var { varType=Just "Mapping", varKey=Just k, varVal=Just v } = TypeMapping (simplevarToSimpleType k) (varToType v)

varToType Var { varType=Just "Enum", varTypedef=Just enumName } = TypeEnum enumName
varToType v = SimpleType $ simplevarToSimpleType $ varAsSimpleVar v



varAsSimpleVar::Var->SimpleVar
varAsSimpleVar Var{varType=Just varType, varBytes=varBytes, varDynamic=varDynamic, varSigned=varSigned, varEntry=Nothing} =
  SimpleVar{
    simplevarType=varType,
    simplevarBytes=varBytes,
    simplevarDynamic=varDynamic,
    simplevarSigned=varSigned,
    simplevarEntry=Nothing
    }
varAsSimpleVar Var{varType=Just varType, varBytes=varBytes, varDynamic=varDynamic, varSigned=varSigned, varEntry=Just Var{varType=Just innerType, varBytes=Just innerBytes}} =
  SimpleVar{
    simplevarType=varType,
    simplevarBytes=varBytes,
    simplevarDynamic=varDynamic,
    simplevarSigned=varSigned,
    simplevarEntry=Just Entry{
      entryType=innerType,
      entryBytes=innerBytes
      }
    }
varAsSimpleVar x = error $ "Oops, varAsSimpleVar cannot convert " ++ show x


getEnumDefs::Map Text Var->Map Text EnumSet
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
        fieldsToStruct typeDefs' $ map (fmap varToType) $ sortBy (compare `on` (varAtBytes . snd)) $ Map.toList xabiVars,
     typeDefs=typeDefs'
     }

