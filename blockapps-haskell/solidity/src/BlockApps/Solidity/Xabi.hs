{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Solidity.Xabi where

import           Control.Applicative
import           Control.Lens                 (mapped, (&), (?~), (.~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (camelCase, dropFPrefix)
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import           Data.Proxy
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
import           Generic.Random.Generic
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           BlockApps.Ethereum
import qualified BlockApps.Solidity.Xabi.Def  as Xabi
import qualified BlockApps.Solidity.Xabi.Type as Xabi hiding (Enum)

data Xabi = Xabi
  { xabiFuncs     :: Map Text Func
  , xabiConstr    :: Map Text Func
  , xabiVars      :: Map Text Xabi.VarType
  , xabiTypes     :: Map Text Xabi.Def
  , xabiModifiers :: Map Text Modifier
  } deriving (Eq,Show,Generic)

instance ToJSON Xabi where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON Xabi where
  parseJSON =
    withObject "xabi" $ \v ->
    Xabi <$> v .:? "funcs" .!= Map.empty
         <*> v .:? "constr" .!= Map.empty
         <*> v .:? "vars" .!= Map.empty
         <*> v .:? "types" .!= Map.empty
         <*> v .:? "mods" .!= Map.empty

instance Arbitrary Xabi where arbitrary = genericArbitrary uniform

instance ToSchema Xabi where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Xabi schema"
    & mapped.schema.description ?~ "Xabi types"
    & mapped.schema.example ?~ toJSON sampleXabi
    where
      sampleXabi :: Xabi
      sampleXabi = Xabi
        { xabiFuncs = Map.fromList
          [ ("get", Func { funcArgs = Map.fromList []
                         , funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                         , funcContents = Just "return x; "
                         , funcMutability  = Just View
                         , funcVisibility = Nothing
                         , funcModifiers = Nothing
                         })
          , ("set", Func { funcArgs = Map.fromList [("x",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                         , funcVals = Map.fromList []
                         , funcContents = Just "return; "
                         , funcMutability  = Just Pure
                         , funcVisibility = Nothing
                         , funcModifiers = Nothing
                         })
          ]
        , xabiConstr = Map.fromList []
        , xabiVars = Map.fromList [("storedData",Xabi.VarType {varTypeAtBytes = 0, varTypePublic = Just False, varTypeConstant = Just True, varTypeInitialValue = Nothing, varTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , xabiTypes = Map.fromList [("SimpleStorage", Xabi.Enum {bytes = 0, names = ["SUCCESS", "ERROR"]})]
        , xabiModifiers = Map.fromList [("onlyOwner", Modifier {modifierArgs = Map.fromList [], modifierSelector="onlyOwner", modifierVals=Map.fromList [], modifierContents = Just "if (msg.sender != owner) throw; _;"})]
        }
--------------------------------------------------------------------------------

data StateMutability = Pure | Constant | View | Payable deriving (Eq, Ord, Show, Generic)

instance ToJSON StateMutability where
  toJSON = genericToJSON (aesonDrop 0 camelCase)

instance FromJSON StateMutability where
  parseJSON = genericParseJSON (aesonDrop 0 camelCase)

instance Arbitrary StateMutability where
  arbitrary = genericArbitrary uniform
instance ToSchema StateMutability where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "State Mutability"
    & mapped.schema.description ?~ "Reserved keywords for function state mutability"
    & mapped.schema.example ?~ toJSON View

data Func = Func
  { funcArgs :: Map Text Xabi.IndexedType
  , funcVals :: Map Text Xabi.IndexedType
  , funcMutability :: Maybe StateMutability

  -- These Values are only used for parsing and unparsing solidity.
  -- This data will not be stored in the db and will have no
  -- relevance when constructing from the db.
  , funcContents :: Maybe Text
  , funcVisibility :: Maybe Visibility
  , funcModifiers :: Maybe [String]
  } deriving (Eq,Show,Generic)

funcPayable :: Func -> Bool
funcPayable Func{funcMutability = Just Payable} = True
funcPayable _ = False

funcConstant :: Func -> Bool
funcConstant Func{funcMutability = Nothing} = False
funcConstant Func{funcMutability = Just Payable} = False
funcConstant _ = True

instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary Func where arbitrary = genericArbitrary uniform

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
        , funcMutability = Just View
        , funcVisibility = Nothing
        , funcModifiers = Nothing
        }

data Visibility = Private
                | Public
                | Internal
                | External
  deriving (Eq,Show,Generic)

instance ToJSON Visibility
instance FromJSON Visibility
instance Arbitrary Visibility where arbitrary = genericArbitrary uniform
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
  } deriving (Eq,Show,Generic)

instance ToJSON Modifier where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON Modifier where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary Modifier where arbitrary = genericArbitrary uniform

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

newtype Event = Event { eventLogs :: Map Text Xabi.IndexedType }
              deriving (Eq,Show,Generic)

data Using = Using {} deriving (Eq,Show,Generic)


data ContractDetails = ContractDetails
  { contractdetailsBin        :: Text
  , contractdetailsAddress    :: Maybe (MaybeNamed Address)
  , contractdetailsBinRuntime :: Text
  , contractdetailsCodeHash   :: Keccak256
  , contractdetailsName       :: Text
  , contractdetailsXabi       :: Xabi
  } deriving (Show,Eq,Generic)

instance ToJSON ContractDetails where
  toJSON ContractDetails{..} = object
    [ "bin" .= contractdetailsBin
    , "address" .= contractdetailsAddress
    , "bin-runtime" .= contractdetailsBinRuntime
    , "codeHash" .= contractdetailsCodeHash
    , "name" .= contractdetailsName
    , "xabi" .= contractdetailsXabi
    ]

instance FromJSON ContractDetails where
  parseJSON = withObject "ContractDetails" $ \obj ->
    ContractDetails
      <$> obj .: "bin"
      <*> obj .:? "address"
      <*> obj .: "bin-runtime"
      <*> obj .: "codeHash"
      <*> obj .: "name"
      <*> obj .: "xabi"

instance ToSample ContractDetails where toSamples _ = noSamples

instance Arbitrary ContractDetails where
  arbitrary = genericArbitrary uniform

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
        , contractdetailsCodeHash = keccak256 "digest"
        , contractdetailsName = "DetailsName"
        , contractdetailsXabi = sampleXabi
        }
      sampleXabi :: Xabi
      sampleXabi = Xabi
        { xabiFuncs = Map.fromList
          [ ("get", Func { funcArgs = Map.fromList []
                         , funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                         , funcContents = Just "return x; "
                         , funcMutability = Just View
                         , funcVisibility = Nothing
                         , funcModifiers = Nothing
                         })
          , ("set", Func { funcArgs = Map.fromList [("x",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
                         , funcVals = Map.fromList []
                         , funcContents = Just "return; "
                         , funcMutability = Just View
                         , funcVisibility = Nothing
                         , funcModifiers = Nothing
                         })
          ]
        , xabiConstr = Map.fromList []
        , xabiVars = Map.fromList [("storedData",Xabi.VarType {varTypeAtBytes = 0, varTypePublic = Just False, varTypeConstant = Just True, varTypeInitialValue = Nothing, varTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , xabiTypes = Map.fromList [("SimpleStorage", Xabi.Enum {bytes = 0, names = ["SUCCESS", "ERROR"]})]
        , xabiModifiers = Map.fromList [("onlyOwner", Modifier {modifierArgs = Map.fromList [], modifierSelector="onlyOwner", modifierVals=Map.fromList [], modifierContents = Just "if (msg.sender != owner) throw; _;"})]
        }

--------------------------------------------------------------------------------

data MaybeNamed a = Named Text | Unnamed a deriving (Eq,Show,Generic)

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
