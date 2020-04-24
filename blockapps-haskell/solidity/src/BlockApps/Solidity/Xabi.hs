{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TupleSections     #-}

module BlockApps.Solidity.Xabi where

import           Control.Applicative
import           Control.DeepSeq
import           Control.Lens                 (mapped, (&), (?~), (.~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (camelCase, dropFPrefix)
import           Data.Aeson.Types
import qualified Data.HashMap.Strict          as Hash
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import           Data.Maybe                   (listToMaybe, maybeToList)
import           Data.Proxy
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
import qualified Generic.Random               as GR
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           BlockApps.Ethereum
import qualified BlockApps.Solidity.Xabi.Def  as Xabi
import qualified BlockApps.Solidity.Xabi.Type as Xabi hiding (Enum)
import           Blockchain.Strato.Model.Address

data XabiKind = ContractKind
              | InterfaceKind
              | LibraryKind deriving (Eq, Show, Generic, NFData)

instance ToJSON XabiKind where
instance FromJSON XabiKind where
instance Arbitrary XabiKind where
  arbitrary = elements [ContractKind, InterfaceKind, LibraryKind]

instance ToSchema XabiKind where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Xabi Kind Schema"
    & mapped.schema.description ?~ "Whether this xabi is a contract, a library, or an interface"
    & mapped.schema.example ?~ toJSON ContractKind

data Xabi = Xabi
  { xabiFuncs     :: Map Text Func
  , xabiConstr    :: Maybe Func
  , xabiVars      :: Map Text Xabi.VarType
  , xabiTypes     :: Map Text Xabi.Def
  , xabiModifiers :: Map Text Modifier
  , xabiEvents    :: Map Text Event
  , xabiKind      :: XabiKind
  , xabiUsing     :: Map Text Using
  } deriving (Eq,Show,Generic,NFData)

instance ToJSON Xabi where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON Xabi where
  parseJSON =
    withObject "xabi" $ \v ->
    Xabi <$> v .:? "funcs" .!= Map.empty
         <*> v .:? "constr" .!= Nothing
         <*> v .:? "vars" .!= Map.empty
         <*> v .:? "types" .!= Map.empty
         <*> v .:? "mods" .!= Map.empty
         <*> v .:? "events" .!= Map.empty
         <*> v .:? "kind" .!= ContractKind
         <*> v .:? "using" .!= Map.empty

instance Arbitrary Xabi where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Xabi where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Xabi schema"
    & mapped.schema.description ?~ "Xabi types"
    & mapped.schema.example ?~ toJSON sampleXabi

sampleXabi :: Xabi
sampleXabi = Xabi
  { xabiFuncs = Map.fromList
    [ ("get", Func { funcArgs = Map.fromList []
                   , funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                   , funcContents = Just "return x; "
                   , funcStateMutability  = Just View
                   , funcVisibility = Nothing
                   , funcModifiers = Nothing
                   })
    , ("set", Func { funcArgs = Map.fromList [("x",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                   , funcVals = Map.fromList []
                   , funcContents = Just "return; "
                   , funcStateMutability  = Just Pure
                   , funcVisibility = Nothing
                   , funcModifiers = Nothing
                   })
    ]
  , xabiConstr = Nothing
  , xabiVars = Map.fromList [("storedData",Xabi.VarType {varTypeAtBytes = 0, varTypePublic = Just False, varTypeConstant = Just True, varTypeInitialValue = Nothing, varTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
  , xabiTypes = Map.fromList [("SimpleStorage", Xabi.Enum {bytes = 0, names = ["SUCCESS", "ERROR"]})]
  , xabiModifiers = Map.fromList [("onlyOwner", Modifier {modifierArgs = Map.fromList [], modifierSelector="onlyOwner", modifierVals=Map.fromList [], modifierContents = Just "if (msg.sender != owner) throw; _;"})]
  , xabiEvents = Map.empty
  , xabiKind = ContractKind
  , xabiUsing = Map.singleton "SafeMath" (Using "for uint256")
  }

xabiEmpty :: Xabi
xabiEmpty = Xabi Map.empty Nothing Map.empty Map.empty Map.empty Map.empty ContractKind Map.empty

constructorToFuncMap :: Maybe Func -> Map Text Func
constructorToFuncMap = Map.fromList . maybeToList . fmap ("constructor",)

funcMapToConstructor :: Map Text Func -> Maybe Func
funcMapToConstructor = fmap snd . listToMaybe . Map.toList

--------------------------------------------------------------------------------

data StateMutability = Pure | Constant | View | Payable deriving (Eq, Ord, Show, Generic, NFData)

tShow :: StateMutability -> Text
tShow Pure = "pure"
tShow Constant = "constant"
tShow View = "view"
tShow Payable = "payable"

tRead :: Text -> Maybe StateMutability
tRead "pure" = Just Pure
tRead "constant" = Just Constant
tRead "view" = Just View
tRead "payable" = Just Payable
tRead _ = Nothing

instance ToJSON StateMutability where
  toJSON = String . tShow

instance FromJSON StateMutability where
  parseJSON = withText "StateMutability" $ \t ->
      case tRead t of
          Just sm -> pure sm
          Nothing -> fail $ "invalid StateMutability: " ++ show t


instance Arbitrary StateMutability where
  arbitrary = GR.genericArbitrary GR.uniform
instance ToSchema StateMutability where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "State Mutability"
    & mapped.schema.description ?~ "Reserved keywords for function state mutability"
    & mapped.schema.example ?~ toJSON View

data Func = Func
  { funcArgs :: Map Text Xabi.IndexedType
  , funcVals :: Map Text Xabi.IndexedType
  , funcStateMutability :: Maybe StateMutability

  -- These Values are only used for parsing and unparsing solidity.
  -- This data will not be stored in the db and will have no
  -- relevance when constructing from the db.
  , funcContents :: Maybe Text
  , funcVisibility :: Maybe Visibility
  , funcModifiers :: Maybe [String]
  } deriving (Eq,Show,Generic,NFData)

funcPayable :: Func -> Bool
funcPayable Func{funcStateMutability = Just Payable} = True
funcPayable _ = False

funcConstant :: Func -> Bool
funcConstant Func{funcStateMutability = Nothing} = False
funcConstant Func{funcStateMutability = Just Payable} = False
funcConstant _ = True

instance ToJSON Func where
  toJSON f = case genericToJSON (aesonPrefix camelCase) f of
                 Object o -> Object
                        . Hash.insert "payable" (Bool . funcPayable $ f)
                        . Hash.insert "constant" (Bool . funcConstant $ f)
                        $ o
                 x -> x

-- constant and payable are a deprecated way of specifying state mutability
fallbackConstantPayable :: Value -> Parser (Maybe StateMutability)
fallbackConstantPayable = withObject "fallbackConstantPayable" $ \obj ->
    let constant = Hash.lookup "constant" obj
        payable = Hash.lookup "payable" obj
    in case (constant, payable) of
           (Just (Bool True), Just (Bool True)) -> fail "functions cannot be constant and payable"
           (Just (Bool True), _) -> pure . Just $ Constant
           (_, Just (Bool True)) -> pure . Just $ Payable
           _ -> pure Nothing

instance FromJSON Func where
  parseJSON val = do
    func <- genericParseJSON (aesonPrefix camelCase) val
    case funcStateMutability func of
      Just _ -> return func
      Nothing -> do
          mut <- fallbackConstantPayable val
          return func{funcStateMutability = mut}

instance Arbitrary Func where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Func where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Function Type"
    & mapped.schema.description ?~ "Xabi Function Type"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: Func
      ex = Func
        { funcArgs = Map.fromList [("userAddress", Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , funcContents = Just "return userAddress;"
        , funcStateMutability = Just View
        , funcVisibility = Nothing
        , funcModifiers = Nothing
        }

data Visibility = Private
                | Public
                | Internal
                | External
  deriving (Eq,Show,Generic,NFData)

instance ToJSON Visibility
instance FromJSON Visibility
instance Arbitrary Visibility where arbitrary = GR.genericArbitrary GR.uniform
instance ToSchema Visibility where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Visibility of a Function"
    & mapped.schema.description ?~ "Xabi Function Visibility"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: Visibility
      ex = Public

data Modifier = Modifier
  { modifierArgs     :: Map Text Xabi.IndexedType
  , modifierSelector :: Text
  , modifierVals     :: Map Text Xabi.IndexedType
  , modifierContents :: Maybe Text
  } deriving (Eq,Show,Generic,NFData)

instance ToJSON Modifier where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON Modifier where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary Modifier where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Modifier where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Function Modifier"
    & mapped.schema.description ?~ "Xabi Function Modifier"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: Modifier
      ex = Modifier
        { modifierArgs = Map.fromList [("userAddress", Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , modifierSelector = "0adfe412"
        , modifierVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , modifierContents = Nothing
        }

data Event = Event { eventAnonymous :: Bool
                   , eventLogs :: [(Text, Xabi.IndexedType)]
                   }
              deriving (Eq,Show,Generic,NFData)

instance ToJSON Event where
  toJSON e = object [
      "anonymous" .= eventAnonymous e
    , "logs" .= eventLogs e
    ]

instance FromJSON Event where
  parseJSON (Object o) = Event
                     <$> (o .: "anonymous")
                     <*> (o .: "logs")
  parseJSON o = typeMismatch "Xabi.Event: Expected Object" o

instance Arbitrary Event where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Event where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Event schema"
    & mapped.schema.description ?~ "Xabi Event"
    & mapped.schema.example ?~ toJSON sampleEvent
    where
      sampleEvent :: Event
      sampleEvent = Event
        { eventAnonymous = True
        , eventLogs =
          [ ("_from", Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Address})
          , ("_to", Xabi.IndexedType {indexedTypeIndex = 1, indexedTypeType = Xabi.Address})
          ]
        }

newtype Using = Using String deriving (Eq,Show,Generic,NFData)

instance ToJSON Using where
  toJSON (Using dec) = String . Text.pack $ dec

instance FromJSON Using where
  parseJSON (String t) = pure . Using . Text.unpack $ t
  parseJSON o = typeMismatch "Xabi.Using" o

instance Arbitrary Using where
  arbitrary = Using <$> arbitrary

instance ToSchema Using where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
     & mapped.name ?~ "Using schema"
     & mapped.schema.description ?~ "Xabi of a `using` declaration"
     & mapped.schema.example ?~ toJSON sampleUsing
     where sampleUsing :: Using
           sampleUsing = Using "for uint[]"


data ContractDetails = ContractDetails
  { contractdetailsBin        :: Text
  , contractdetailsAddress    :: Maybe (MaybeNamed Address)
  , contractdetailsBinRuntime :: Text
  , contractdetailsCodeHash   :: CodePtr
  , contractdetailsName       :: Text
  , contractdetailsSrc        :: Text
  , contractdetailsXabi       :: Xabi
  , contractdetailsChainId    :: Maybe ChainId
  } deriving (Show,Eq,Generic,NFData)

instance ToJSON ContractDetails where
  toJSON ContractDetails{..} = object
    [ "bin" .= contractdetailsBin
    , "address" .= contractdetailsAddress
    , "bin-runtime" .= contractdetailsBinRuntime
    , "codeHash" .= contractdetailsCodeHash
    , "name" .= contractdetailsName
    , "src" .= contractdetailsSrc
    , "xabi" .= contractdetailsXabi
    , "chainId" .= contractdetailsChainId
    ]

instance FromJSON ContractDetails where
  parseJSON = withObject "ContractDetails" $ \obj ->
    ContractDetails
      <$> obj .: "bin"
      <*> obj .:? "address"
      <*> obj .: "bin-runtime"
      <*> obj .: "codeHash"
      <*> obj .: "name"
      <*> obj .: "src"
      <*> obj .: "xabi"
      <*> obj .:? "chainId"

instance ToSample ContractDetails where toSamples _ = noSamples

instance Arbitrary ContractDetails where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema ContractDetails where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "ContractDetails"
    & mapped.schema.description ?~ "Returned data from contract creation."
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: ContractDetails
      ex = ContractDetails
        { contractdetailsBin = "ContractBin"
        , contractdetailsAddress = Just (Unnamed (Address 0xdeadbeef))
        , contractdetailsBinRuntime = "ContractRuntime"
        , contractdetailsCodeHash = EVMCode $ SHA 0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365
        , contractdetailsName = "DetailsName"
        , contractdetailsSrc = "contract DetailsName { }"
        , contractdetailsXabi = sampleXabi
        , contractdetailsChainId = Nothing
        }

--------------------------------------------------------------------------------

data MaybeNamed a = Named Text | Unnamed a deriving (Eq,Show,Generic,NFData)

instance ToJSON a => ToJSON (MaybeNamed a) where
  toJSON (Named _name) = toJSON _name
  toJSON (Unnamed a)   = toJSON a

instance FromJSON a => FromJSON (MaybeNamed a) where
  parseJSON x = Unnamed <$> parseJSON x <|> Named <$> parseJSON x

instance Arbitrary a => Arbitrary (MaybeNamed a) where
  arbitrary = oneof
    [ elements [Named "name1", Named "name2", Named "name3"]
    , Unnamed <$> arbitrary
    ]

instance ToHttpApiData (MaybeNamed Address) where
  toUrlPiece (Named _name)  = _name
  toUrlPiece (Unnamed addr) = Text.pack . addressString $ addr

instance FromHttpApiData (MaybeNamed Address) where
  parseUrlPiece txt = case stringAddress (Text.unpack txt) of
    Nothing   -> Right $ Named txt
    Just addr -> Right $ Unnamed addr

instance ToSample (MaybeNamed Address) where
  toSamples _ = [("Sample", Unnamed (Address 0xdeadbeef))]

instance ToCapture (Capture "contractAddress" (MaybeNamed Address)) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address or Contract Name"

instance ToParamSchema (MaybeNamed Address) where
  toParamSchema _ = toParamSchema (Proxy :: Proxy Address)

instance ToSchema (MaybeNamed Address) where
  declareNamedSchema _ = return $ NamedSchema (Just "Contract Name, \"Latest\", Or Address")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ toJSON (Unnamed (Address 0xdeadbeef))
        & description ?~ "Contract Name, \"Latest\", Or Address" )

soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }
