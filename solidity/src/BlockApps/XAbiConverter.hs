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
   
xabiTypeToSimpleType::Xabi.Type->SimpleType
xabiTypeToSimpleType Xabi.String{} = TypeString
xabiTypeToSimpleType Xabi.Address = TypeAddress

xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=1 } = TypeInt8
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=2 } = TypeInt16
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=3 } = TypeInt24
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=4 } = TypeInt32
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=5 } = TypeInt40
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=6 } = TypeInt48
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=7 } = TypeInt56
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=8 } = TypeInt64
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=9 } = TypeInt72
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=10 } = TypeInt80
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=11 } = TypeInt88
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=12 } = TypeInt96
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=13 } = TypeInt104
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=14 } = TypeInt112
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=15 } = TypeInt120
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=16 } = TypeInt128
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=17 } = TypeInt136
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=18 } = TypeInt144
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=19 } = TypeInt152
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=20 } = TypeInt160
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=21 } = TypeInt168
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=22 } = TypeInt176
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=23 } = TypeInt184
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=24 } = TypeInt192
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=25 } = TypeInt200
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=26 } = TypeInt208
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=27 } = TypeInt216
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=28 } = TypeInt224
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=29 } = TypeInt232
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=30 } = TypeInt240
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=31 } = TypeInt248
xabiTypeToSimpleType Xabi.Int { Xabi.signed=True, Xabi.bytes=32 } = TypeInt256

xabiTypeToSimpleType Xabi.Int { Xabi.bytes=1 } = TypeUInt8
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=2 } = TypeUInt16
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=3 } = TypeUInt24
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=4 } = TypeUInt32
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=5 } = TypeUInt40
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=6 } = TypeUInt48
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=7 } = TypeUInt56
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=8 } = TypeUInt64
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=9 } = TypeUInt72
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=10 } = TypeUInt80
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=11 } = TypeUInt88
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=12 } = TypeUInt96
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=13 } = TypeUInt104
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=14 } = TypeUInt112
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=15 } = TypeUInt120
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=16 } = TypeUInt128
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=17 } = TypeUInt136
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=18 } = TypeUInt144
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=19 } = TypeUInt152
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=20 } = TypeUInt160
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=21 } = TypeUInt168
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=22 } = TypeUInt176
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=23 } = TypeUInt184
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=24 } = TypeUInt192
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=25 } = TypeUInt200
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=26 } = TypeUInt208
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=27 } = TypeUInt216
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=28 } = TypeUInt224
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=29 } = TypeUInt232
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=30 } = TypeUInt240
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=31 } = TypeUInt248
xabiTypeToSimpleType Xabi.Int { Xabi.bytes=32 } = TypeUInt256
xabiTypeToSimpleType v = error $ "undefined var in xabiTypeToSimpleType: " ++ show v -- show (Xabi.xabiTypeType v) ++ ":" ++ show (xabiTypeBytes v)



xabiTypeToType::Xabi.Type->Type
xabiTypeToType Xabi.Array { Xabi.length=Just len, Xabi.entry=var } =
  TypeArrayFixed len $ xabiTypeToType var
xabiTypeToType Xabi.Array { Xabi.entry=var } =
  TypeArrayDynamic $ xabiTypeToType var
xabiTypeToType Xabi.Contract { Xabi.typedef=name } = TypeContract name
--xabiTypeToType Xabi.Mapping { Xabi.key=k, Xabi.value=v } = TypeMapping (xabiTypeToSimpleType k) (xabiTypeToType v)
xabiTypeToType Xabi.Enum { Xabi.typedef=enumName } = TypeEnum enumName
xabiTypeToType Xabi.Struct { Xabi.typedef=name } = TypeStruct name
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
       undefined
--       (Map.toList $ fmap (xabiTypeToType . Xabi.indexedXabiTypeType) funcArgs)
       undefined
--       (map (\(name, val) -> (Just name, xabiTypeToType $ Xabi.indexedXabiTypeType val)) $ Map.toList funcVals)


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

