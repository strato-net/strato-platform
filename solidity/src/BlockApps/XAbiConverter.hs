{-#
  LANGUAGE
    OverloadedStrings
  , RecordWildCards
#-}


module BlockApps.XAbiConverter where

import Data.Function
import Data.List
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
    varEntry=undefined,
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
    varEntry=undefined,
    varVal=undefined,
    varKey=undefined
    }





varToType Var { varType=Just "String" } = SimpleType TypeString
varToType Var { varType=Just "Int", varBytes=Just 1 } = SimpleType TypeInt8
varToType Var { varType=Just "Int", varBytes=Just 4 } = SimpleType TypeInt32
varToType Var { varType=Just "Int", varBytes=Just 32 } = SimpleType TypeInt256
varToType v = error $ "undefined var in varToType: " ++ show (varType v) ++ ":" ++ show (varBytes v)

xAbiToContract::Xabi->Contract
xAbiToContract Xabi{..} =
  let
    typeDefs' = TypeDefs{enumDefs=Map.fromList [], structDefs=Map.fromList []}
  in
   Contract{
     mainStruct=
        fieldsToStruct typeDefs' $ map (fmap varToType) $ sortBy (compare `on` (varAtBytes . snd)) $ Map.toList xabiVars,
     typeDefs=typeDefs'
     }

