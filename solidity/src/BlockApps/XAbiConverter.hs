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
import Data.Vector (Vector)
import qualified Data.Vector as Vector

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

intTypes::Vector SimpleType
intTypes=Vector.fromList
  [
    TypeInt8, TypeInt16, TypeInt24, TypeInt32,
    TypeInt40, TypeInt48, TypeInt56, TypeInt64,
    TypeInt72, TypeInt80, TypeInt88, TypeInt96,
    TypeInt104, TypeInt112, TypeInt120, TypeInt128,
    TypeInt136, TypeInt144, TypeInt152, TypeInt160,
    TypeInt168, TypeInt176, TypeInt184, TypeInt192,
    TypeInt200, TypeInt208, TypeInt216, TypeInt224,
    TypeInt232, TypeInt240, TypeInt248, TypeInt256
  ]

uintTypes::Vector SimpleType
uintTypes= Vector.fromList
  [
    TypeUInt8, TypeUInt16, TypeUInt24, TypeUInt32,
    TypeUInt40, TypeUInt48, TypeUInt56, TypeUInt64,
    TypeUInt72, TypeUInt80, TypeUInt88, TypeUInt96,
    TypeUInt104, TypeUInt112, TypeUInt120, TypeUInt128,
    TypeUInt136, TypeUInt144, TypeUInt152, TypeUInt160,
    TypeUInt168, TypeUInt176, TypeUInt184, TypeUInt192,
    TypeUInt200, TypeUInt208, TypeUInt216, TypeUInt224,
    TypeUInt232, TypeUInt240, TypeUInt248, TypeUInt256
  ]
   
xabiTypeToSimpleType::Xabi.Type->SimpleType
xabiTypeToSimpleType Xabi.String{} = TypeString
xabiTypeToSimpleType Xabi.Address = TypeAddress
xabiTypeToSimpleType Xabi.Int {Xabi.signed=signed, Xabi.bytes=b} =
  case signed of
   Just True -> intTypes Vector.! fromIntegral (b-1)
   _ -> uintTypes Vector.! fromIntegral (b-1)
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
       (Map.toList $ fmap (xabiTypeToType . Xabi.indexedTypeType) funcArgs)
       (map (\(name, val) -> (Just name, xabiTypeToType $ Xabi.indexedTypeType val)) $ Map.toList funcVals)


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

