{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Solidity.Xabi where

import           Control.Applicative
import           Control.DeepSeq
import           Control.Lens                 (mapped, (&), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (camelCase, dropFPrefix)
import           Data.Aeson.Types
import           Data.Binary
import qualified Data.HashMap.Strict          as Hash
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
import qualified Generic.Random               as GR
import           GHC.Generics
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           BlockApps.Ethereum
--import           SolidVM.Solidity.Parse.Expression
import           SolidVM.Solidity.Xabi.Statement
import qualified SolidVM.Solidity.Xabi.Def  as Xabi
import qualified SolidVM.Solidity.Xabi.Type as Xabi hiding (Enum)
import qualified SolidVM.Solidity.Xabi.VarDef  as Xabi

data XabiKind = ContractKind
              | InterfaceKind
              | LibraryKind deriving (Eq, Show, Read, Generic, NFData, Binary)

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
  , xabiConstr    :: Map Text Func
  , xabiVars      :: Map Text VariableDecl
  , xabiConstants :: Map Text ConstantDecl
  , xabiTypes     :: Map Text Xabi.Def
  , xabiModifiers :: Map Text Modifier
  , xabiEvents    :: Map Text Event
  , xabiKind      :: XabiKind
  , xabiUsing     :: Map Text Using
  } deriving (Eq,Show,Read,Generic,NFData,Binary)
{-
sampleXabi :: Xabi
sampleXabi = Xabi
  { xabiFuncs = Map.fromList
    [ ("get", Func { funcArgs = Map.fromList []
                   , funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                   , funcContents = Just []
                   , funcStateMutability  = Just View
                   , funcVisibility = Nothing
                   , funcConstructorCalls = Map.empty
                   , funcModifiers = Nothing
                   })
    , ("set", Func { funcArgs = Map.fromList [("x",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                   , funcVals = Map.fromList []
                   , funcContents = Just []
                   , funcStateMutability  = Just Pure
                   , funcVisibility = Nothing
                   , funcConstructorCalls = Map.empty
                   , funcModifiers = Nothing
                   })
    ]
  , xabiConstr = Map.fromList []
  , xabiConstants = Map.empty
  , xabiVars = Map.fromList [("storedData",(Xabi.VarType {varTypeAtBytes = 0, varTypePublic = Just False, varTypeConstant = Just True, varTypeInitialValue = Nothing, varTypeType = Xabi.Int {signed = Just False, bytes = Just 32}}, Nothing))]
  , xabiTypes = Map.fromList [("SimpleStorage", Xabi.Enum {bytes = 0, names = ["SUCCESS", "ERROR"]})]
  , xabiModifiers = Map.fromList [("onlyOwner", Modifier {modifierArgs = Map.fromList [], modifierSelector="onlyOwner", modifierVals=Map.fromList [], modifierContents = Just "if (msg.sender != owner) throw; _;"})]
  , xabiEvents = Map.empty
  , xabiKind = ContractKind
  , xabiUsing = Map.singleton "SafeMath" (Using "for uint256")
  }
-}
xabiEmpty :: Xabi
xabiEmpty = Xabi Map.empty Map.empty Map.empty Map.empty Map.empty Map.empty Map.empty ContractKind Map.empty
--------------------------------------------------------------------------------

data StateMutability = Pure | Constant | View | Payable deriving (Eq, Ord, Show, Read, Generic, NFData,Binary)

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
  , funcContents :: Maybe [Statement]
  , funcVisibility :: Maybe Visibility
  , funcConstructorCalls :: Map String [Expression]
  , funcModifiers :: Maybe [String]
  } deriving (Eq,Show,Read,Generic,NFData,Binary)

data VariableDecl =
  VariableDecl {
  varType :: Xabi.Type,
  varIsPublic :: Bool,
  varInitialVal :: Maybe Expression
  } deriving (Show, Read, Eq,Generic,NFData, Binary)

data ConstantDecl =
  ConstantDecl {
  constType :: Xabi.Type,
  constIsPublic :: Bool,
  constInitialVal :: Expression
  } deriving (Show, Read, Eq, Generic, NFData, Binary)

funcPayable :: Func -> Bool
funcPayable Func{funcStateMutability = Just Payable} = True
funcPayable _ = False

funcConstant :: Func -> Bool
funcConstant Func{funcStateMutability = Nothing} = False
funcConstant Func{funcStateMutability = Just Payable} = False
funcConstant _ = True

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

data Visibility = Private
                | Public
                | Internal
                | External
  deriving (Eq,Show,Read,Generic, NFData, Binary)

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
  } deriving (Eq,Show,Read,Generic, NFData, Binary)

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
              deriving (Eq,Show,Read,Generic, NFData, Binary)

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

newtype Using = Using String deriving (Eq,Show,Read,Generic, NFData, Binary)

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
  , contractdetailsCodeHash   :: Keccak256
  , contractdetailsName       :: Text
  , contractdetailsSrc        :: Text
  , contractdetailsXabi       :: Xabi
  , contractdetailsChainId    :: Maybe ChainId
  } deriving (Show,Eq,Generic, NFData, Binary)

instance ToSample ContractDetails where toSamples _ = noSamples

--------------------------------------------------------------------------------

data MaybeNamed a = Named Text | Unnamed a deriving (Eq,Show,Generic, NFData, Binary)

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

soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }
