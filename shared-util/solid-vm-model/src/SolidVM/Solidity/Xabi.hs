{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Solidity.Xabi where

import           Control.Lens                 (mapped, (&), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types
import qualified Data.HashMap.Strict          as Hash
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import           Data.Source
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           BlockApps.Ethereum2
import           Blockchain.Strato.Model.Account
import           SolidVM.Model.CodeCollection.ConstantDecl
import           SolidVM.Model.CodeCollection.Function
import           SolidVM.Model.CodeCollection.VariableDecl
import qualified SolidVM.Solidity.Xabi.Def  as Xabi
import qualified SolidVM.Model.CodeCollection.Type as SVMType hiding (Enum)
import qualified SolidVM.Solidity.Xabi.VarDef  as Xabi

data XabiKind = ContractKind
              | InterfaceKind
              | LibraryKind deriving (Eq, Show, Generic)

instance ToJSON XabiKind where
instance FromJSON XabiKind where
instance Arbitrary XabiKind where
  arbitrary = elements [ContractKind, InterfaceKind, LibraryKind]

instance ToSchema XabiKind where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Xabi Kind Schema"
    & mapped.schema.description ?~ "Whether this xabi is a contract, a library, or an interface"
    & mapped.schema.example ?~ toJSON ContractKind

data XabiF a = Xabi
  { xabiFuncs     :: Map Text (FuncF a)
  , xabiConstr    :: Map Text (FuncF a)
  , xabiVars      :: Map Text (VariableDeclF a)
  , xabiConstants :: Map Text (ConstantDeclF a)
  , xabiTypes     :: Map Text Xabi.Def
  , xabiModifiers :: Map Text (ModifierF a)
  , xabiEvents    :: Map Text (EventF a)
  , xabiKind      :: XabiKind
  , xabiUsing     :: Map Text (UsingF a)
  , xabiContext   :: a
  } deriving (Eq,Show,Generic, Functor)

type Xabi = Positioned XabiF

xabiEmpty :: XabiF ()
xabiEmpty = Xabi Map.empty Map.empty Map.empty Map.empty Map.empty Map.empty Map.empty ContractKind Map.empty ()
--------------------------------------------------------------------------------

funcPayable :: FuncF a -> Bool
funcPayable Func{funcStateMutability = Just Payable} = True
funcPayable _ = False

funcConstant :: FuncF a -> Bool
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

data ModifierF a = Modifier
  { modifierArgs     :: Map Text Xabi.IndexedType
  , modifierSelector :: Text
  , modifierVals     :: Map Text Xabi.IndexedType
  , modifierContents :: Maybe Text
  , modifierContext  :: a
  } deriving (Eq,Show,Generic, Functor)

type Modifier = Positioned ModifierF

instance ToJSON a => ToJSON (ModifierF a) where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON a => FromJSON (ModifierF a) where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary a => Arbitrary (ModifierF a) where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Modifier where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Function Modifier"
    & mapped.schema.description ?~ "Xabi Function Modifier"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: ModifierF ()
      ex = Modifier
        { modifierArgs = Map.fromList [("userAddress", Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = SVMType.Int {signed = Just False, bytes = Just 32}})]
        , modifierSelector = "0adfe412"
        , modifierVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = SVMType.Int {signed = Just False, bytes = Just 32}})]
        , modifierContents = Nothing
        , modifierContext = ()
        }

data EventF a = Event
  { eventAnonymous :: Bool
  , eventLogs :: [(Text, Xabi.IndexedType)]
  , eventContext :: a
  } deriving (Eq,Show,Generic, Functor)

type Event = Positioned EventF

instance ToJSON a => ToJSON (EventF a) where
  toJSON e = object [
      "anonymous" .= eventAnonymous e
    , "logs" .= eventLogs e
    , "context" .= eventContext e
    ]

instance FromJSON a => FromJSON (EventF a) where
  parseJSON (Object o) = Event
                     <$> (o .: "anonymous")
                     <*> (o .: "logs")
                     <*> (o .: "context")
  parseJSON o = typeMismatch "Xabi.Event: Expected Object" o

instance Arbitrary a => Arbitrary (EventF a) where
  arbitrary = GR.genericArbitrary GR.uniform

data UsingF a = Using String a deriving (Eq,Show,Generic, Functor)

type Using = Positioned UsingF

instance ToJSON a => ToJSON (UsingF a) where
  toJSON (Using dec ctx) = object
    [ "using" .= dec
    , "context" .= ctx
    ]

instance FromJSON a => FromJSON (UsingF a) where
  parseJSON (Object o) = Using
                     <$> (o .: "using")
                     <*> (o .: "context")
  parseJSON o = typeMismatch "Xabi.Using" o

instance Arbitrary a => Arbitrary (UsingF a) where
  arbitrary = Using <$> arbitrary <*> arbitrary

instance ToSchema Using where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
     & mapped.name ?~ "Using schema"
     & mapped.schema.description ?~ "Xabi of a `using` declaration"
     & mapped.schema.example ?~ toJSON sampleUsing
     where sampleUsing :: UsingF ()
           sampleUsing = Using "for uint[]" ()


data ContractDetailsF a = ContractDetails
  { contractdetailsBin        :: Text
  , contractdetailsAccount    :: Maybe Account
  , contractdetailsBinRuntime :: Text
  , contractdetailsCodeHash   :: Keccak256
  , contractdetailsName       :: Text
  , contractdetailsSrc        :: SourceMap
  , contractdetailsXabi       :: XabiF a
  } deriving (Show,Eq,Generic, Functor)

type ContractDetails = Positioned ContractDetailsF

instance ToSample ContractDetails where toSamples _ = noSamples

--------------------------------------------------------------------------------

soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }
