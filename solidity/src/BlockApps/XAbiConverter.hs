{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE RecursiveDo       #-}


module BlockApps.XAbiConverter where

import qualified Data.Bimap                        as Bimap
import           Data.List
import qualified Data.Map                          as Map
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import           Data.Traversable
import           Data.Vector                       (Vector)
import qualified Data.Vector                       as Vector

import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Parse.Selector
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.TypeDefs
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Def       as XabiDef
import qualified BlockApps.Solidity.Xabi.Type      as Xabi
import qualified BlockApps.Storage                 as Storage


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
   (position:) <$> addPositions typeDefs' (Storage.addBytes position usedBytes) rest

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
   _         -> uintTypes Vector.! fromIntegral (b-1)
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
   Nothing -> Left $ "Contract is using a label that has not been defined as an enum, struct, or contract: " ++ name ++ "\navailable names: " ++ show (map fst $ Map.toList $ xabiTypes xabi)
   Just (XabiDef.Enum _ _) -> return $ TypeEnum $ Text.pack name
   Just (XabiDef.Struct _ _) -> return $ TypeStruct $ Text.pack name
   Just (XabiDef.Contract _) -> return $ TypeContract $ Text.pack name
xabiTypeToType xabi Xabi.Mapping { Xabi.key=k, Xabi.value=v } = do
  value <- xabiTypeToType xabi v
  return $ TypeMapping (xabiTypeToSimpleType k) value
xabiTypeToType _ Xabi.Enum { Xabi.typedef=enumName } = return $ TypeEnum enumName
xabiTypeToType _ Xabi.Struct { Xabi.typedef=name } = return $ TypeStruct name
xabiTypeToType _ v = return $ SimpleType $ xabiTypeToSimpleType v


funcToType::Xabi->Text->Func->Either String Type
funcToType xabi name Func{..} = do

  let orderedFuncArgs = sortOn (Xabi.indexedTypeIndex . snd) $ Map.toList funcArgs
  
  convertedFuncArgs <- for orderedFuncArgs $ \(name', theType) -> do
    theType' <- xabiTypeToType xabi . Xabi.indexedTypeType $ theType
    return (name', theType')

  convertedFuncVals <- for (Map.toList funcVals) $ \(name', val) -> do
    val' <- xabiTypeToType xabi $ Xabi.indexedTypeType val
    return (Just name', val')

  let enumSizes =
        [(name', length items) |
         (name', XabiDef.Enum items _) <- Map.toList $ xabiTypes xabi]

  let selector = deriveSelector enumSizes name $ map snd convertedFuncArgs

  return $ TypeFunction
                selector
                convertedFuncArgs
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
xabiFieldsToFields xabi xabifields = for xabifields $ \(name, field) -> do
    theType <- xabiTypeToType xabi $ Xabi.fieldTypeType field
    return (name, theType)



xabiToTypeDefs::TypeDefs->Xabi->Either String TypeDefs
xabiToTypeDefs typeDefs' xabi@Xabi{..} = do
  let
    xabiEnums = [(enumName, names) |
                 (enumName, XabiDef.Enum{..}) <- Map.toList xabiTypes]
    xabiStructs = [(structName, Map.toList fields) |
                   (structName, XabiDef.Struct{..}) <- Map.toList xabiTypes]::[(Text, [(Text, Xabi.FieldType)])]


  structDefs' <- for xabiStructs $ \(name, fields) -> do
      theStruct <-
        fmap (fieldsToStruct typeDefs') $ xabiFieldsToFields xabi
        $ sortOn (Xabi.fieldTypeAtBytes . snd) fields
      return (name, theStruct)

  return TypeDefs { enumDefs   = Map.fromList $ fmap (Bimap.fromList . zip [0..]) <$> xabiEnums
                  , structDefs = Map.fromList structDefs'::Map.Map Text Struct
                  }


xAbiToContract::Xabi->Either String Contract
xAbiToContract contractXabi@Xabi{..} = mdo
  typeDefs' <- xabiToTypeDefs typeDefs' contractXabi

  let vars' = sortOn (Xabi.varTypeAtBytes . snd) $ Map.toList xabiVars
  vars <- for vars' $ \(name, var) -> do
    var' <- (xabiTypeToType contractXabi . Xabi.varTypeType) var
    return (name, var')

  funcs <-
    fmap Map.fromList $
    for (Map.toList xabiFuncs) $ \(name, func) -> do
      theFunction <- funcToType contractXabi name func
      return (name, theFunction)


  return Contract{
    mainStruct=fieldsToStruct typeDefs' $ vars ++ Map.toList funcs,
    typeDefs=typeDefs'
    }


--------------------------------------------
--Inverse Conversion

contractToXabi::Contract->Xabi
contractToXabi Contract{..} =
  let
    functions = Map.fromList [(name, Func (Map.fromList $ argsToIndexedTypes args) (Map.fromList $ varsToIndexedTypes rets)) | (name, (_, TypeFunction _ args rets)) <- Map.toList $ fields mainStruct]
    vars = filter (not . isFunction . snd . snd) $ Map.toList $ fields mainStruct::[(Text, (Storage.Position, Type))]
    isFunction::Type->Bool
    isFunction (TypeFunction _ _ _) = True
    isFunction _ = False
    
  in
    Xabi{
      xabiFuncs = functions,
      xabiConstr = Map.empty,
      xabiVars = Map.fromList $ map (fmap fieldToVarType) vars,
      xabiTypes = Map.empty
      }

fieldToVarType::(Storage.Position, Type)->Xabi.VarType
fieldToVarType (Storage.Position{..}, theType) = Xabi.VarType (fromIntegral $ 32*offset+fromIntegral byte) Nothing $ typeToXabiType theType

typeToXabiType::Type->Xabi.Type
typeToXabiType (SimpleType x) = simpleTypeToXabiType x
typeToXabiType (TypeArrayDynamic theType) = Xabi.Array Nothing Nothing (typeToXabiType theType)
typeToXabiType (TypeMapping from to) = Xabi.Mapping Nothing (simpleTypeToXabiType from) (typeToXabiType to)
typeToXabiType (TypeFunction _ _ _) = error "typeToXabiType was called with function type, which isn't allowed"
typeToXabiType x = error $ "Missing type in call to typeToXabiType: " ++ show x

simpleTypeToXabiType::SimpleType->Xabi.Type
simpleTypeToXabiType TypeBool = Xabi.Bool
simpleTypeToXabiType TypeInt8 = Xabi.Int Nothing $ Just 8
simpleTypeToXabiType TypeInt16 = Xabi.Int Nothing $ Just 16
simpleTypeToXabiType TypeInt24 = Xabi.Int Nothing $ Just 24
simpleTypeToXabiType TypeInt32 = Xabi.Int Nothing $ Just 32
simpleTypeToXabiType TypeInt40 = Xabi.Int Nothing $ Just 40
simpleTypeToXabiType TypeInt48 = Xabi.Int Nothing $ Just 48
simpleTypeToXabiType TypeInt56 = Xabi.Int Nothing $ Just 56
simpleTypeToXabiType TypeInt64 = Xabi.Int Nothing $ Just 64
simpleTypeToXabiType TypeInt72 = Xabi.Int Nothing $ Just 72
simpleTypeToXabiType TypeInt80 = Xabi.Int Nothing $ Just 80
simpleTypeToXabiType TypeInt88 = Xabi.Int Nothing $ Just 88
simpleTypeToXabiType TypeInt96 = Xabi.Int Nothing $ Just 96
simpleTypeToXabiType TypeInt104 = Xabi.Int Nothing $ Just 104
simpleTypeToXabiType TypeInt112 = Xabi.Int Nothing $ Just 112
simpleTypeToXabiType TypeInt120 = Xabi.Int Nothing $ Just 120
simpleTypeToXabiType TypeInt128 = Xabi.Int Nothing $ Just 128
simpleTypeToXabiType TypeInt136 = Xabi.Int Nothing $ Just 136
simpleTypeToXabiType TypeInt144 = Xabi.Int Nothing $ Just 144
simpleTypeToXabiType TypeInt152 = Xabi.Int Nothing $ Just 152
simpleTypeToXabiType TypeInt160 = Xabi.Int Nothing $ Just 160
simpleTypeToXabiType TypeInt168 = Xabi.Int Nothing $ Just 168
simpleTypeToXabiType TypeInt176 = Xabi.Int Nothing $ Just 176
simpleTypeToXabiType TypeInt184 = Xabi.Int Nothing $ Just 184
simpleTypeToXabiType TypeInt192 = Xabi.Int Nothing $ Just 192
simpleTypeToXabiType TypeInt200 = Xabi.Int Nothing $ Just 200
simpleTypeToXabiType TypeInt208 = Xabi.Int Nothing $ Just 208
simpleTypeToXabiType TypeInt216 = Xabi.Int Nothing $ Just 216
simpleTypeToXabiType TypeInt224 = Xabi.Int Nothing $ Just 224
simpleTypeToXabiType TypeInt232 = Xabi.Int Nothing $ Just 232
simpleTypeToXabiType TypeInt240 = Xabi.Int Nothing $ Just 240
simpleTypeToXabiType TypeInt248 = Xabi.Int Nothing $ Just 248
simpleTypeToXabiType TypeInt256 = Xabi.Int Nothing $ Just 256
simpleTypeToXabiType TypeInt = Xabi.Int Nothing Nothing


simpleTypeToXabiType TypeUInt8 = Xabi.Int (Just True) $ Just 8
simpleTypeToXabiType TypeUInt16 = Xabi.Int (Just True) $ Just 16
simpleTypeToXabiType TypeUInt24 = Xabi.Int (Just True) $ Just 24
simpleTypeToXabiType TypeUInt32 = Xabi.Int (Just True) $ Just 32
simpleTypeToXabiType TypeUInt40 = Xabi.Int (Just True) $ Just 40
simpleTypeToXabiType TypeUInt48 = Xabi.Int (Just True) $ Just 48
simpleTypeToXabiType TypeUInt56 = Xabi.Int (Just True) $ Just 56
simpleTypeToXabiType TypeUInt64 = Xabi.Int (Just True) $ Just 64
simpleTypeToXabiType TypeUInt72 = Xabi.Int (Just True) $ Just 72
simpleTypeToXabiType TypeUInt80 = Xabi.Int (Just True) $ Just 80
simpleTypeToXabiType TypeUInt88 = Xabi.Int (Just True) $ Just 88
simpleTypeToXabiType TypeUInt96 = Xabi.Int (Just True) $ Just 96
simpleTypeToXabiType TypeUInt104 = Xabi.Int (Just True) $ Just 104
simpleTypeToXabiType TypeUInt112 = Xabi.Int (Just True) $ Just 112
simpleTypeToXabiType TypeUInt120 = Xabi.Int (Just True) $ Just 120
simpleTypeToXabiType TypeUInt128 = Xabi.Int (Just True) $ Just 128
simpleTypeToXabiType TypeUInt136 = Xabi.Int (Just True) $ Just 136
simpleTypeToXabiType TypeUInt144 = Xabi.Int (Just True) $ Just 144
simpleTypeToXabiType TypeUInt152 = Xabi.Int (Just True) $ Just 152
simpleTypeToXabiType TypeUInt160 = Xabi.Int (Just True) $ Just 160
simpleTypeToXabiType TypeUInt168 = Xabi.Int (Just True) $ Just 168
simpleTypeToXabiType TypeUInt176 = Xabi.Int (Just True) $ Just 176
simpleTypeToXabiType TypeUInt184 = Xabi.Int (Just True) $ Just 184
simpleTypeToXabiType TypeUInt192 = Xabi.Int (Just True) $ Just 192
simpleTypeToXabiType TypeUInt200 = Xabi.Int (Just True) $ Just 200
simpleTypeToXabiType TypeUInt208 = Xabi.Int (Just True) $ Just 208
simpleTypeToXabiType TypeUInt216 = Xabi.Int (Just True) $ Just 216
simpleTypeToXabiType TypeUInt224 = Xabi.Int (Just True) $ Just 224
simpleTypeToXabiType TypeUInt232 = Xabi.Int (Just True) $ Just 232
simpleTypeToXabiType TypeUInt240 = Xabi.Int (Just True) $ Just 240
simpleTypeToXabiType TypeUInt248 = Xabi.Int (Just True) $ Just 248
simpleTypeToXabiType TypeUInt256 = Xabi.Int (Just True) $ Just 256
simpleTypeToXabiType TypeUInt = Xabi.Int (Just True) Nothing

simpleTypeToXabiType TypeAddress = Xabi.Address
simpleTypeToXabiType TypeString = Xabi.String Nothing


simpleTypeToXabiType TypeBytes1 = Xabi.Bytes Nothing $ Just 1
simpleTypeToXabiType TypeBytes2 = Xabi.Bytes Nothing $ Just 2
simpleTypeToXabiType TypeBytes3 = Xabi.Bytes Nothing $ Just 3
simpleTypeToXabiType TypeBytes4 = Xabi.Bytes Nothing $ Just 4
simpleTypeToXabiType TypeBytes5 = Xabi.Bytes Nothing $ Just 5
simpleTypeToXabiType TypeBytes6 = Xabi.Bytes Nothing $ Just 6
simpleTypeToXabiType TypeBytes7 = Xabi.Bytes Nothing $ Just 7
simpleTypeToXabiType TypeBytes8 = Xabi.Bytes Nothing $ Just 8
simpleTypeToXabiType TypeBytes9 = Xabi.Bytes Nothing $ Just 9
simpleTypeToXabiType TypeBytes10 = Xabi.Bytes Nothing $ Just 10
simpleTypeToXabiType TypeBytes11 = Xabi.Bytes Nothing $ Just 11
simpleTypeToXabiType TypeBytes12 = Xabi.Bytes Nothing $ Just 12
simpleTypeToXabiType TypeBytes13 = Xabi.Bytes Nothing $ Just 13
simpleTypeToXabiType TypeBytes14 = Xabi.Bytes Nothing $ Just 14
simpleTypeToXabiType TypeBytes15 = Xabi.Bytes Nothing $ Just 15
simpleTypeToXabiType TypeBytes16 = Xabi.Bytes Nothing $ Just 16
simpleTypeToXabiType TypeBytes17 = Xabi.Bytes Nothing $ Just 17
simpleTypeToXabiType TypeBytes18 = Xabi.Bytes Nothing $ Just 18
simpleTypeToXabiType TypeBytes19 = Xabi.Bytes Nothing $ Just 19
simpleTypeToXabiType TypeBytes20 = Xabi.Bytes Nothing $ Just 20
simpleTypeToXabiType TypeBytes21 = Xabi.Bytes Nothing $ Just 21
simpleTypeToXabiType TypeBytes22 = Xabi.Bytes Nothing $ Just 22
simpleTypeToXabiType TypeBytes23 = Xabi.Bytes Nothing $ Just 23
simpleTypeToXabiType TypeBytes24 = Xabi.Bytes Nothing $ Just 24
simpleTypeToXabiType TypeBytes25 = Xabi.Bytes Nothing $ Just 25
simpleTypeToXabiType TypeBytes26 = Xabi.Bytes Nothing $ Just 26
simpleTypeToXabiType TypeBytes27 = Xabi.Bytes Nothing $ Just 27
simpleTypeToXabiType TypeBytes28 = Xabi.Bytes Nothing $ Just 28
simpleTypeToXabiType TypeBytes29 = Xabi.Bytes Nothing $ Just 29
simpleTypeToXabiType TypeBytes30 = Xabi.Bytes Nothing $ Just 30
simpleTypeToXabiType TypeBytes31 = Xabi.Bytes Nothing $ Just 31
simpleTypeToXabiType TypeBytes32 = Xabi.Bytes Nothing $ Just 32
simpleTypeToXabiType TypeBytes = Xabi.Bytes Nothing Nothing

argsToIndexedTypes::[(Text, Type)]->[(Text, Xabi.IndexedType)]
argsToIndexedTypes _ = []

varsToIndexedTypes::[(Maybe Text, Type)]->[(Text, Xabi.IndexedType)]
varsToIndexedTypes _ = []



{-

data Struct = Struct { fields::Map Text (Storage.Position, Type) , size::Word256 } deriving (Show)

data Func = Func
  { funcArgs :: Map Text Xabi.IndexedType
  , funcVals :: Map Text Xabi.IndexedType
  } deriving (Eq,Show,Generic)

-}
