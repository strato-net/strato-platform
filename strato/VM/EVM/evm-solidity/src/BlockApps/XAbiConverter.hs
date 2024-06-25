{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}

module BlockApps.XAbiConverter where

import BlockApps.Solidity.Contract
import BlockApps.Solidity.Parse.Selector
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Def as XabiDef
import qualified BlockApps.Solidity.Xabi.Type as Xabi
import qualified BlockApps.Storage as Storage
import qualified Data.Bimap as Bimap
import Data.List
import qualified Data.Map as Map
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Traversable
import GHC.Int

fieldsToStruct :: TypeDefs -> [((Text, Type), Maybe Text)] -> Struct
fieldsToStruct typeDefs' vars =
  let constants = filter (isJust . snd) vars
      variables = map fst $ filter (isNothing . snd) vars
      (positionAfter, positions) =
        addPositions typeDefs' (Storage.positionAt 0) $
          map snd variables
   in Struct
        { fields =
            OMap.fromList $
              (map (\((n, t), c) -> (n, (constantValue c, t))) constants)
                ++ zipWith (\(n, t) p -> (n, (Right p, t))) variables positions,
          size = fromIntegral $ 32 * Storage.offset positionAfter + roundUp (Storage.byte positionAfter)
        }
  where
    constantValue mval = maybe (error "fieldsToStruct: You must supply a value to a constant") Left mval
    roundUp n = if n == 0 then 0 else 32

addPositions :: TypeDefs -> Storage.Position -> [Type] -> (Storage.Position, [Storage.Position])
addPositions _ p [] = (p, [])
addPositions typeDefs' p0 (theType : rest) =
  let (position, usedBytes) = getPositionAndSize typeDefs' p0 theType
   in (position :) <$> addPositions typeDefs' (Storage.addBytes position usedBytes) rest

xabiTypeToSimpleType :: Xabi.Type -> SimpleType
xabiTypeToSimpleType Xabi.String {} = TypeString
xabiTypeToSimpleType Xabi.Address = TypeAddress
xabiTypeToSimpleType Xabi.Account = TypeAccount
xabiTypeToSimpleType Xabi.Int {Xabi.signed = signed, Xabi.bytes = b} =
  case signed of
    Just True -> TypeInt True $ fmap toInteger b
    _ -> TypeInt False $ fmap toInteger b
xabiTypeToSimpleType (Xabi.Bytes _ b) = TypeBytes $ fmap toInteger b
xabiTypeToSimpleType Xabi.Bool = TypeBool
xabiTypeToSimpleType Xabi.Decimal = TypeDecimal
xabiTypeToSimpleType v = error $ "undefined var in xabiTypeToSimpleType: " ++ show v -- show (Xabi.xabiTypeType v) ++ ":" ++ show (xabiTypeBytes v)

xabiTypeToType :: Xabi.Type -> Either String Type
xabiTypeToType Xabi.Array {Xabi.entry = var, Xabi.length = (Just l)} =
  TypeArrayFixed l <$> xabiTypeToType var
xabiTypeToType Xabi.Array {Xabi.entry = var, Xabi.length = Nothing} =
  TypeArrayDynamic <$> xabiTypeToType var
xabiTypeToType Xabi.Contract {Xabi.typedef = name} = return $ TypeContract name
xabiTypeToType (Xabi.UnknownLabel name) = return $ TypeContract $ Text.pack name -- TODO: Add enums and structs back in
--  case Map.lookup (Text.pack name) (xabiTypes xabi) of
--   Nothing -> Left $ "Contract is using a label that has not been defined as an enum, struct, or contract: " ++ name ++ "\navailable names: " ++ show (map fst $ Map.toList $ xabiTypes xabi)
--   Just (XabiDef.Enum _ _) -> return $ TypeEnum $ Text.pack name
--   Just (XabiDef.Struct _ _) -> return $ TypeStruct $ Text.pack name
--   Just (XabiDef.Contract _) -> return $ TypeContract $ Text.pack name
xabiTypeToType Xabi.Mapping {Xabi.key = k, Xabi.value = v} = do
  value <- xabiTypeToType v
  return $ TypeMapping (xabiTypeToSimpleType k) value
xabiTypeToType Xabi.Enum {Xabi.typedef = enumName} = return $ TypeEnum enumName
xabiTypeToType Xabi.Struct {Xabi.typedef = name} = return $ TypeStruct name
xabiTypeToType Xabi.Variadic {} = return $ TypeVariadic
xabiTypeToType v = return $ SimpleType $ xabiTypeToSimpleType v

funcToType :: Xabi -> Text -> Func -> Either String Type
funcToType xabi name Func {..} = do
  let orderedFuncArgs = sortOn (Xabi.indexedTypeIndex . snd) $ Map.toList funcArgs

  convertedFuncArgs <- for orderedFuncArgs $ \(name', theType) -> do
    theType' <- xabiTypeToType . Xabi.indexedTypeType $ theType
    return (name', theType')

  convertedFuncVals <- for (Map.toList funcVals) $ \(name', val) -> do
    val' <- xabiTypeToType $ Xabi.indexedTypeType val
    return (Just name', val')

  let enumSizes =
        [ (name', length items)
          | (name', XabiDef.Enum items _) <- Map.toList $ xabiTypes xabi
        ]

  let selector = deriveSelector enumSizes name $ map snd convertedFuncArgs

  return $
    TypeFunction
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

xabiFieldsToFields :: Xabi -> [(Text, Xabi.FieldType)] -> Either String [(Text, Type)]
xabiFieldsToFields _ xabifields = for xabifields $ \(name, field) -> do
  theType <- xabiTypeToType $ Xabi.fieldTypeType field
  return (name, theType)

xabiToTypeDefs :: TypeDefs -> Xabi -> Either String TypeDefs
xabiToTypeDefs typeDefs' xabi@Xabi {..} = do
  let xabiEnums =
        [ (enumName, names)
          | (enumName, XabiDef.Enum {..}) <- Map.toList xabiTypes
        ]
      xabiStructs =
        [ (structName, fields)
          | (structName, XabiDef.Struct {..}) <- Map.toList xabiTypes
        ] ::
          [(Text, [(Text, Xabi.FieldType)])]

  structDefs' <- for xabiStructs $ \(name, fields) -> do
    theStruct <-
      fmap (fieldsToStruct typeDefs' . map (flip (,) Nothing)) $
        xabiFieldsToFields xabi $
          sortOn (Xabi.fieldTypeAtBytes . snd) fields
    return (name, theStruct)

  return
    TypeDefs
      { enumDefs = Map.fromList $ fmap (Bimap.fromList . zip [0 ..]) <$> xabiEnums,
        structDefs = Map.fromList structDefs' :: Map.Map Text Struct
      }

xAbiToContract :: Xabi -> Either String Contract
xAbiToContract contractXabi@Xabi {..} = mdo
  typeDefs' <- xabiToTypeDefs typeDefs' contractXabi

  -- The contract datatype doesn't have a notion of constants, so it's ok to filter them out here
  let vars' = sortOn (Xabi.varTypeAtBytes . snd) $ Map.toList xabiVars
  vars <- for vars' $ \(name, var) -> do
    var' <- (xabiTypeToType . Xabi.varTypeType) var
    return ((name, var'), Text.pack <$> (Xabi.varTypeConstant var >>= \b -> if b then Xabi.varTypeInitialValue var else Nothing))

  let constrMap = constructorToFuncMap xabiConstr
  funcs <-
    for (Map.toList $ Map.union xabiFuncs constrMap) $ \(name, func) -> do
      theFunction <- funcToType contractXabi name func
      return ((name, theFunction), Nothing)

  return
    Contract
      { mainStruct = fieldsToStruct typeDefs' $ vars ++ funcs,
        typeDefs = typeDefs'
      }

--------------------------------------------
--Inverse Conversion

-- DANGER: Lossy function! Does not preserve typedefs, modifiers, events, or usings.
--         Use with caution, only when returning from API, not to be converted back
--         into a Contract type.
contractToXabi :: Text -> Contract -> Xabi
contractToXabi cName Contract {..} =
  let functions =
        Map.fromList
          [ ( name,
              Func
                { funcArgs = (Map.fromList $ zipWith (argToIndexedTypes typeDefs) [0 ..] args),
                  funcVals = (Map.fromList $ zipWith (varToIndexedTypes typeDefs) [0 ..] rets),
                  funcContents = Nothing,
                  funcStateMutability = Nothing,
                  funcVisibility = Nothing,
                  funcModifiers = Nothing
                }
            )
            | (name, (_, TypeFunction _ args rets)) <- OMap.assocs $ fields mainStruct
          ]
      vars = filter (not . isFunction . snd . snd) $ OMap.assocs $ fields mainStruct :: [(Text, (Either Text Storage.Position, Type))]
      isFunction :: Type -> Bool
      isFunction TypeFunction {} = True
      isFunction _ = False
      isConstructor k = const (k == cName || k == "constructor")
      (constructors, funcs) = Map.partitionWithKey isConstructor functions
      mCtor = funcMapToConstructor constructors
   in Xabi
        { xabiFuncs = funcs,
          xabiConstr = mCtor,
          xabiVars = Map.fromList $ map (fmap $ fieldToVarType typeDefs) vars,
          xabiTypes = Map.empty,
          xabiModifiers = Map.empty,
          xabiEvents = Map.empty,
          xabiKind = ContractKind,
          xabiUsing = Map.empty
        }

fieldToVarType :: TypeDefs -> (Either Text Storage.Position, Type) -> Xabi.VarType
fieldToVarType typeDefs (Right Storage.Position {..}, theType) =
  Xabi.VarType
    (fromIntegral $ 32 * offset + fromIntegral byte)
    Nothing
    Nothing
    Nothing
    $ typeToXabiType typeDefs theType
fieldToVarType typeDefs (Left text, theType) =
  Xabi.VarType
    0
    Nothing
    (Just True)
    (Just $ Text.unpack text)
    $ typeToXabiType typeDefs theType

-- Array {dynamic::Maybe Bool, length::Maybe Word, entry::Type}
typeToXabiType :: TypeDefs -> Type -> Xabi.Type
typeToXabiType _ (SimpleType x) = simpleTypeToXabiType x
typeToXabiType typeDefs (TypeArrayDynamic theType) =
  Xabi.Array (typeToXabiType typeDefs theType) Nothing
typeToXabiType typeDefs (TypeArrayFixed size theType) =
  Xabi.Array (typeToXabiType typeDefs theType) (Just size)
typeToXabiType typeDefs (TypeMapping from to) =
  Xabi.Mapping (Just True) (simpleTypeToXabiType from) (typeToXabiType typeDefs to)
typeToXabiType _ (TypeStruct structName) = Xabi.Struct Nothing structName
typeToXabiType typeDefs (TypeEnum enumName) =
  case Map.lookup enumName $ enumDefs typeDefs of
    Nothing -> error $ "undefined enum: " ++ Text.unpack enumName
    Just x -> Xabi.Enum (Just 1) enumName $ Just $ map snd $ sortOn fst $ Bimap.toList x
typeToXabiType _ (TypeContract contractName) = Xabi.Contract contractName
typeToXabiType _ TypeFunction {} = error "typeToXabiType was called with function type, which isn't allowed"
typeToXabiType _ TypeVariadic {} = Xabi.Variadic

simpleTypeToXabiType :: SimpleType -> Xabi.Type
simpleTypeToXabiType TypeBool = Xabi.Bool
simpleTypeToXabiType (TypeInt s b) = Xabi.Int (Just s) $ fmap fromInteger b
simpleTypeToXabiType TypeAddress = Xabi.Address
simpleTypeToXabiType TypeAccount = Xabi.Account
simpleTypeToXabiType TypeString = Xabi.String $ Just True
simpleTypeToXabiType (TypeBytes b) = Xabi.Bytes Nothing $ fmap fromInteger b
simpleTypeToXabiType TypeDecimal = Xabi.Decimal

argToIndexedTypes :: TypeDefs -> Int32 -> (Text, Type) -> (Text, Xabi.IndexedType)
argToIndexedTypes typeDefs i (name, theType) = (name, Xabi.IndexedType i $ typeToXabiType typeDefs theType)

varToIndexedTypes :: TypeDefs -> Int32 -> (Maybe Text, Type) -> (Text, Xabi.IndexedType)
varToIndexedTypes typeDefs i (maybeName, theType) = (fromMaybe (Text.pack $ "#" ++ show i) maybeName, Xabi.IndexedType i $ typeToXabiType typeDefs theType)
