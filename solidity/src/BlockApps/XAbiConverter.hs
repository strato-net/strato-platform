{-#
  LANGUAGE
    OverloadedStrings
  , RecordWildCards
  , RecursiveDo
#-}


module BlockApps.XAbiConverter where

import qualified Data.Bimap as Bimap
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Traversable
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

bytesTypes::Vector SimpleType
bytesTypes = Vector.fromList
  [
    TypeBytes1, TypeBytes2, TypeBytes3, TypeBytes4,
    TypeBytes5, TypeBytes6, TypeBytes7, TypeBytes8,
    TypeBytes9, TypeBytes10, TypeBytes11, TypeBytes12,
    TypeBytes13, TypeBytes14, TypeBytes15, TypeBytes16,
    TypeBytes17, TypeBytes18, TypeBytes19, TypeBytes20,
    TypeBytes21, TypeBytes22, TypeBytes23, TypeBytes24,
    TypeBytes25, TypeBytes26, TypeBytes27, TypeBytes28,
    TypeBytes29, TypeBytes30, TypeBytes31, TypeBytes32
  ]

xabiTypeToSimpleType::Xabi.Type->SimpleType
xabiTypeToSimpleType Xabi.String{} = TypeString
xabiTypeToSimpleType Xabi.Address = TypeAddress
xabiTypeToSimpleType Xabi.Int {Xabi.signed=signed, Xabi.bytes=Just b} =
  case signed of
   Just True -> intTypes Vector.! fromIntegral (b-1)
   _ -> uintTypes Vector.! fromIntegral (b-1)
xabiTypeToSimpleType (Xabi.Bytes _ (Just size)) =
   bytesTypes Vector.! fromIntegral (size-1)
xabiTypeToSimpleType (Xabi.Bytes _ Nothing) = TypeBytes
xabiTypeToSimpleType Xabi.Bool = TypeBool

xabiTypeToSimpleType v = error $ "undefined var in xabiTypeToSimpleType: " ++ show v -- show (Xabi.xabiTypeType v) ++ ":" ++ show (xabiTypeBytes v)


xabiTypeToType::Xabi->Xabi.Type->Either String Type
xabiTypeToType xabi Xabi.Array { Xabi.length=Just len, Xabi.entry=var } =
  TypeArrayFixed len <$> xabiTypeToType xabi var
xabiTypeToType xabi Xabi.Array { Xabi.entry=var } =
  TypeArrayDynamic <$> xabiTypeToType xabi var
xabiTypeToType _ Xabi.Contract { Xabi.typedef=name } = return $ TypeContract name
xabiTypeToType xabi (Xabi.Label name) =
  case Map.lookup (Text.pack name) (xabiTypes xabi) of
   Nothing -> Left $ "Contract is using a label that has not been defined as an enum or struct: " ++ name
   Just (XabiDef.Enum _ _) -> return $ TypeEnum $ Text.pack name
   Just (XabiDef.Struct _ _) -> return $ TypeStruct $ Text.pack name
xabiTypeToType xabi Xabi.Mapping { Xabi.key=k, Xabi.value=v } = do
  value <- xabiTypeToType xabi v
  return $ TypeMapping (xabiTypeToSimpleType k) value
xabiTypeToType _ Xabi.Enum { Xabi.typedef=enumName } = return $ TypeEnum enumName
xabiTypeToType _ Xabi.Struct { Xabi.typedef=name } = return $ TypeStruct name
xabiTypeToType _ v = return $ SimpleType $ xabiTypeToSimpleType v


funcToType::Xabi->Func->Either String Type
funcToType xabi Func{..} = do
  let selector =
        case B16.decode $ BC.pack $ Text.unpack funcSelector of
         (val, "") -> val
         _ -> error "selector in function is bad"

  convertedFuncArgs <- for funcArgs $ xabiTypeToType xabi . Xabi.indexedTypeType

  convertedFuncVals <- for (Map.toList funcVals) $ \(name, val) -> do
    val' <- xabiTypeToType xabi $ Xabi.indexedTypeType val
    return (Just name, val')
  
  return $ TypeFunction
                selector
                (Map.toList convertedFuncArgs)
                convertedFuncVals


{-
data Xabi = Xabi
  { xabiFuncs :: Map Text Func
  , xabiConstr :: Map Text Xabi.IndexedType
  , xabiVars :: Map Text Xabi.VarType
  , xabiTypes :: Map Text Xabi.Def
  } deriving (Eq,Show,Generic)

data Def =
  Enum {
    names::[Text],
    bytes::Word
    }
  | Struct {
    fields::Map Text Xabi.FieldType,
    bytes::Word
    } deriving (Eq, Show, Generic)

data Struct =
  Struct {
    fields::Map Text (Storage.Position, Type),
    size::Word256
    } deriving (Show)

data FieldType = FieldType
  { fieldTypeAtBytes :: Int32
  , fieldTypeType :: Type
  } deriving (Eq, Show, Generic)


-}

xabiFieldsToFields::Xabi->[(Text, Xabi.FieldType)]->Either String [(Text, Type)]
xabiFieldsToFields xabi xabifields = do
  for xabifields $ \(name, field) -> do
    theType <- xabiTypeToType xabi $ Xabi.fieldTypeType field
    return (name, theType)

  

xabiToTypeDefs::TypeDefs->Xabi->Either String TypeDefs
xabiToTypeDefs typeDefs' xabi@Xabi{..} = do
  let
    xabiEnums = [(enumName, names) |
                 (enumName, XabiDef.Enum{..}) <- Map.toList xabiTypes]
    xabiStructs = [(structName, Map.toList fields) |
                   (structName, XabiDef.Struct{..}) <- Map.toList xabiTypes]::[(Text, [(Text, Xabi.FieldType)])]

  
  structDefs' <-
    for xabiStructs $ \(name, fields) -> do
      theStruct <- 
        fmap (fieldsToStruct typeDefs') $ xabiFieldsToFields xabi 
        $ sortOn (Xabi.fieldTypeAtBytes . snd) fields
      return (name, theStruct)
  
  return $
    TypeDefs{
      enumDefs=
        Map.fromList $
          map (fmap (Bimap.fromList . zip [0..])) xabiEnums,
      
      structDefs=Map.fromList structDefs'::Map.Map Text Struct





                 
--      flip Struct (Storage.positionAt 0) $ Map.fromList
--         [(name, (0, fields)) | (name, Xabi.Struct fields _) <- Map.toList xabiTypes]
      } 


xAbiToContract::Xabi->Either String Contract
xAbiToContract contractXabi@Xabi{..} = mdo
  typeDefs' <- xabiToTypeDefs typeDefs' contractXabi
  
  let vars' = sortOn (Xabi.varTypeAtBytes . snd) $ Map.toList xabiVars
  vars <- for vars' $ \(name, var) -> do
    var' <- (xabiTypeToType contractXabi . Xabi.varTypeType) var
    return (name, var')
  
  funcs <- traverse (funcToType contractXabi) xabiFuncs
            

  return Contract{
    mainStruct=fieldsToStruct typeDefs' $ vars ++ Map.toList funcs,
    typeDefs=typeDefs'
    }
