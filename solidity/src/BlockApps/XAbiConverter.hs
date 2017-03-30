{-#
  LANGUAGE
    OverloadedStrings
  , RecordWildCards
#-}


module BlockApps.XAbiConverter where

import qualified Data.Bimap as Bimap
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Function
import Data.List
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Tuple

import BlockApps.Solidity.Xabi
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import qualified BlockApps.Storage as Storage
import qualified BlockApps.Solidity.Xabi.Def as XabiDef
import qualified BlockApps.Solidity.Xabi.Type as Xabi

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
   
xabiTypeToSimpleType::Xabi.XabiType->SimpleType
xabiTypeToSimpleType Xabi.XabiType{ Xabi.xabiTypeType="String" } = TypeString
xabiTypeToSimpleType Xabi.XabiType{ Xabi.xabiTypeType="Address" } = TypeAddress

xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 1 } = TypeInt8
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 2 } = TypeInt16
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 3 } = TypeInt24
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 4 } = TypeInt32
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 5 } = TypeInt40
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 6 } = TypeInt48
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 7 } = TypeInt56
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 8 } = TypeInt64
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 9 } = TypeInt72
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 10 } = TypeInt80
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 11 } = TypeInt88
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 12 } = TypeInt96
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 13 } = TypeInt104
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 14 } = TypeInt112
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 15 } = TypeInt120
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 16 } = TypeInt128
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 17 } = TypeInt136
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 18 } = TypeInt144
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 19 } = TypeInt152
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 20 } = TypeInt160
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 21 } = TypeInt168
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 22 } = TypeInt176
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 23 } = TypeInt184
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 24 } = TypeInt192
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 25 } = TypeInt200
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 26 } = TypeInt208
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 27 } = TypeInt216
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 28 } = TypeInt224
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 29 } = TypeInt232
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 30 } = TypeInt240
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 31 } = TypeInt248
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeSigned=Just True, xabiTypeBytes=Just 32 } = TypeInt256

xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 1 } = TypeUInt8
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 2 } = TypeUInt16
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 3 } = TypeUInt24
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 4 } = TypeUInt32
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 5 } = TypeUInt40
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 6 } = TypeUInt48
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 7 } = TypeUInt56
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 8 } = TypeUInt64
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 9 } = TypeUInt72
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 10 } = TypeUInt80
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 11 } = TypeUInt88
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 12 } = TypeUInt96
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 13 } = TypeUInt104
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 14 } = TypeUInt112
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 15 } = TypeUInt120
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 16 } = TypeUInt128
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 17 } = TypeUInt136
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 18 } = TypeUInt144
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 19 } = TypeUInt152
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 20 } = TypeUInt160
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 21 } = TypeUInt168
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 22 } = TypeUInt176
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 23 } = TypeUInt184
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 24 } = TypeUInt192
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 25 } = TypeUInt200
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 26 } = TypeUInt208
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 27 } = TypeUInt216
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 28 } = TypeUInt224
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 29 } = TypeUInt232
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 30 } = TypeUInt240
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 31 } = TypeUInt248
xabiTypeToSimpleType Xabi.XabiType { Xabi.xabiTypeType="Int", xabiTypeBytes=Just 32 } = TypeUInt256
xabiTypeToSimpleType v = error $ "undefined var in xabiTypeToSimpleType: " ++ show v -- show (Xabi.xabiTypeType v) ++ ":" ++ show (xabiTypeBytes v)



xabiTypeToType::Xabi.XabiType->Type
xabiTypeToType Xabi.XabiType { Xabi.xabiTypeType="Array", xabiTypeLength=Just len, xabiTypeEntry=Just var } =
  TypeArrayFixed len $ xabiTypeToType var
xabiTypeToType Xabi.XabiType { Xabi.xabiTypeType="Array", xabiTypeEntry=Just var } =
  TypeArrayDynamic $ xabiTypeToType var
xabiTypeToType Xabi.XabiType { Xabi.xabiTypeType="Contract", Xabi.xabiTypeTypedef=Just name } = TypeContract name
xabiTypeToType Xabi.XabiType { Xabi.xabiTypeType="Mapping", xabiTypeKey=Just k, xabiTypeValue=Just v } = TypeMapping (xabiTypeToSimpleType k) (xabiTypeToType v)
xabiTypeToType Xabi.XabiType { Xabi.xabiTypeType="Enum", Xabi.xabiTypeTypedef=Just enumName } = TypeEnum enumName
xabiTypeToType Xabi.XabiType { Xabi.xabiTypeType="Struct", Xabi.xabiTypeTypedef=Just name } = TypeStruct name
xabiTypeToType v = SimpleType $ xabiTypeToSimpleType v



funcToType::Func->Type
funcToType Func{..} =
  let
    selector =
      case B16.decode $ BC.pack $ Text.unpack funcSelector of
       (val, "") -> val
       _ -> error "selector in function is bad"
  in
   TypeFunction
       selector
       (Map.toList $ fmap (xabiTypeToType . Xabi.indexedXabiTypeType) funcArgs)
       (map (\(name, val) -> (Just name, xabiTypeToType $ Xabi.indexedXabiTypeType val)) $ Map.toList funcVals)


xAbiToContract::Xabi->Contract
xAbiToContract Xabi{..} =
  let
    typeDefs' = TypeDefs{
      enumDefs=
          fmap (Bimap.fromList . map swap . Map.toList . XabiDef.names) xabiTypes,
      structDefs=Map.empty
--      flip Struct (Storage.positionAt 0) $ Map.fromList
--         [(name, (0, fields)) | (name, Xabi.Struct fields _) <- Map.toList xabiTypes]
      }
  in
   Contract{
     mainStruct=
        fieldsToStruct typeDefs' $
            (map (fmap (xabiTypeToType . Xabi.varTypeType)) $ sortBy (compare `on` (Xabi.varTypeAtBytes . snd)) $ Map.toList xabiVars)
            ++ map (fmap funcToType) (Map.toList xabiFuncs)
     ,
     typeDefs=typeDefs'
     }

