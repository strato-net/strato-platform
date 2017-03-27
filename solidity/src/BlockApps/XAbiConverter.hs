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
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 1 } = TypeInt8
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 4 } = TypeInt32
simplevarToSimpleType SimpleVar { simplevarType="Int", simplevarBytes=Just 32 } = TypeInt256

simplevarToSimpleType v = error $ "undefined var in varToSimpleType: " ++ show (simplevarType v) ++ ":" ++ show (simplevarBytes v)




varToType::Var->Type
varToType Var { varType=Just "Array", varLength=Just len, varEntry=Just Var{varType=entryType, varBytes=b} } =
  TypeArrayFixed len $ varToType Var{ --I think Entry should just be Var, and this messy undefined thing could be avoided
    varType=entryType,
    varAtBytes=undefined,
    varLength=undefined,
    varTypedef=undefined,
    varDynamic=undefined,
    varSigned=undefined,
    varBytes=b,
    varEntry=Nothing,
    varVal=undefined,
    varKey=undefined
    }
varToType Var { varType=Just "Array", varEntry=Just Var{varType=entryType, varBytes=b} } =
  TypeArrayDynamic $ varToType Var{
    varType=entryType,
    varAtBytes=undefined,
    varLength=undefined,
    varTypedef=undefined,
    varDynamic=undefined,
    varSigned=undefined,
    varBytes=b,
    varEntry=Nothing,
    varVal=undefined,
    varKey=undefined
    }




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

