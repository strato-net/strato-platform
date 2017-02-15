{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Contracts where

import Control.Applicative
-- import Control.Monad.Except
-- import Control.Monad.Reader
import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Encoding
-- import Data.Functor.Contravariant
import Data.Int
-- import Data.Monoid
import Data.Proxy
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Foldable
import Data.Traversable
import qualified Data.ByteString as ByteString
import Data.ByteString (ByteString)
import Generic.Random.Generic
import GHC.Generics
import qualified Hasql.Decoders as Decoders
-- import qualified Hasql.Encoders as Encoders
-- import Hasql.Query
-- import Hasql.Session
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data
-- import qualified BlockApps.Solidity as Solidity

class Monad m => MonadContracts m where
  getContracts :: m GetContractsResponse
  getContractsData :: ContractName -> m [MaybeNamed Address]
  getContractsContract :: ContractName -> MaybeNamed Address -> m GetContractsContractResponse
  getContractsState :: ContractName -> MaybeNamed Address -> m GetContractsStateResponses -- state-translation
  getContractsFunctions :: ContractName -> MaybeNamed Address -> m [FunctionName]
  getContractsSymbols :: ContractName -> MaybeNamed Address -> m [SymbolName]
  getContractsStateMapping :: ContractName -> MaybeNamed Address -> SymbolName -> Text -> m GetContractsStateMappingResponse -- state-translation
  getContractsStates :: ContractName -> m [GetContractsStatesResponse] -- state-translation
  postContractsCompile :: [PostCompileRequest] -> m [PostCompileResponse]
instance MonadContracts ClientM where
  getContracts = client (Proxy @ GetContracts)
  getContractsData = client (Proxy @ GetContractsData)
  getContractsContract = client (Proxy @ GetContractsContract)
  getContractsState = client (Proxy @ GetContractsState)
  getContractsFunctions = client (Proxy @ GetContractsFunctions)
  getContractsSymbols = client (Proxy @ GetContractsSymbols)
  getContractsStateMapping = client (Proxy @ GetContractsStateMapping)
  getContractsStates = client (Proxy @ GetContractsStates)
  postContractsCompile = client (Proxy @ PostContractsCompile)
instance MonadContracts Bloc where

  getContracts = undefined
  -- getContracts = do
  --   conn <- asks dbConnection
  --   let
  --     encoder = Encoders.unit
  --     decoder = Decoders.rowsList contractDecoder
  --     sqlString = "SELECT address, timestamp FROM contracts_instance;"
  --     sqlStatement = statement sqlString encoder decoder False
  --   contractsEither <- liftIO $ run (query () sqlStatement) conn
  --   case contractsEither of
  --     Left err -> throwError $ DBError err
  --     Right cons -> return $ Contracts cons

  getContractsData = undefined
  -- getContractsData (ContractName contractName) = do
  --   conn <- asks dbConnection
  --   let
  --     encoder = Encoders.value Encoders.text
  --     decoder = Decoders.rowsList (Decoders.value addressDecoder)
  --     sqlString =
  --       "SELECT CI.address\
  --       \ FROM contracts C JOIN contracts_metadata CM\
  --       \ ON CM.contract_id = C.id\
  --       \ JOIN contracts_instance CI\
  --       \ ON CI.contract_metadata_id = CM.id\
  --       \ WHERE C.name = $1;"
  --     sqlStatement = statement sqlString encoder decoder False
  --   addressesEither <- liftIO $
  --     run (query contractName sqlStatement) conn
  --   case addressesEither of
  --     Left err -> throwError $ DBError err
  --     Right addresses -> return addresses

  getContractsContract = undefined
  -- getContractsContract (ContractName contractName) addr = do
  --   conn <- asks dbConnection
  --   let
  --     encoderContAddr = contramap fst (Encoders.value Encoders.text)
  --       <> contramap snd (Encoders.value addressEncoder)
  --     encoderId = Encoders.value Encoders.int2
  --     decoderCont = undefined
  --     decoderArgs = undefined
  --     decoderRet = undefined
  --     decoderConstr = undefined
  --     decoderVars = undefined
  --     decoderVarEnt = undefined
  --     -- GET Contract Info
  --     sqlStringCont =
  --       "SELECT CM.bin, CM.bin_runtime, CM.code_hash, C.name, CI.address\
  --       \ FROM contracts C\
  --       \ JOIN contracts_metadata CM ON CM.contract_id = C.id\
  --       \ JOIN contracts_instance CI ON CI.contract_metadata_id = CM.id\
  --       \ WHERE C.name = $1 AND CI.address = $2"
  --     -- GET Functions
  --     sqlStringCont =
  --       "SELECT id, name, selector, is_constructor FROM xabi_functions\
  --       \ WHERE contract_metadata_id = $1\
  --     -- GET function arguments
  --     sqlStringArgs =
  --       "SELECT XFA.name, XFA.index, XT.type, XT.typedef, \
  --       \ XT.is_dynamic, XT.is_signed, XT.is_public, XT.bytes, \
  --       \ EXT.type [entry_type], EXT.bytes [entry_bytes], EXT.typedef [entry_typedef]\
  --       \ FROM xabi_functions XF\
  --       \ LEFT OUTER JOIN xabi_function_arguments XFA\
  --       \ ON XFA.function_id = XF.id\
  --       \ LEFT OUTER JOIN xabi_types XT\
  --       \ ON XT.id = XF.type_id\
  --       \ LEFT OUTER JOIN xabi_types EXT\
  --       \ ON EXT.id = XT.entry_type_id\
  --       \ WHERE XFA.function_id = $1 "
  --     -- GET function variables
  --     sqlStringArgs =
  --       "SELECT XFV.name, XFV.at_bytes, XFV.index, XT.type, XT.typedef, \
  --       \ XT.is_dynamic, XT.is_signed, XT.is_public, XT.bytes, \
  --       \ EXT.type [entry_type], EXT.bytes [entry_bytes], EXT.typedef [entry_typedef]\
  --       \ VXT.type [value_type], VXT.bytes [value_bytes], VXT.typedef [value_typedef]\
  --       \ KXT.type [key_type], KXT.bytes [key_bytes], KXT.typedef [key_typedef]\
  --       \ FROM xabi_functions XF\
  --       \ LEFT OUTER JOIN xabi_function_variables XFV\
  --       \ ON XFA.function_id = XF.id\
  --       \ LEFT OUTER JOIN xabi_types XT\
  --       \ ON XT.id = XF.type_id\
  --       \ LEFT OUTER JOIN xabi_types EXT\
  --       \ ON EXT.id = XT.entry_type_id\
  --       \ LEFT OUTER JOIN xabi_types VXT\
  --       \ ON VXT.id = XT.entry_type_id\
  --       \ LEFT OUTER JOIN xabi_types KXT\
  --       \ ON KXT.id = XT.entry_type_id\
  --       \ WHERE XFV.contract_metadata_id = $1 "
  --     sqlStatementCont =
  --       statement sqlStringCont encoderContAddr decoderCont False
  --     sqlStatementArgs =
  --       statement sqlStringArgs encoderId decoderArgs False
  --     sqlStatementRet =
  --       statement sqlStringRet encoderId decoderRet False
  --     sqlStatementConstr =
  --       statement sqlStringCont encoderContAddr decoderConstr False
  --     sqlStatementVars =
  --       statement sqlStringVars encoderContAddr decoderVars False
  --     sqlStatementVarEnt =
  --       statement sqlStringVars encoderId decoderVarEnt False
  --   undefined
  --   -- contractEither <- liftIO $
  --   --   run (query (contractName,addr) sqlStatementContract) conn
  --   -- case contractEither of
  --   --   Left err -> throwError $ DBError err
  --   --   Right contract -> return contract

  getContractsState = undefined

  getContractsFunctions = undefined
  -- getContractsFunctions (ContractName contractName) addr = do
  --   conn <- asks dbConnection
  --   let
  --     encoder = contramap fst (Encoders.value Encoders.text)
  --       <> contramap snd (Encoders.value addressEncoder)
  --     decoder =
  --       Decoders.rowsList . Decoders.value $ FunctionName <$> Decoders.text
  --     sqlString =
  --       "SELECT XF.Name FROM contracts C\
  --       \ JOIN contracts_metadata CM ON CM.contract_id = C.id\
  --       \ JOIN contracts_instance CI ON CI.contract_metadata_id = CM.id\
  --       \ JOIN xabi_functions XF ON XF.contract_metadata_id = CM.id\
  --       \ WHERE C.name = $1 AND CI.address = $2 AND NOT XF.is_constructor"
  --     sqlStatement = statement sqlString encoder decoder False
  --   functionsEither <- liftIO $
  --     run (query (contractName,addr) sqlStatement) conn
  --   case functionsEither of
  --     Left err -> throwError $ DBError err
  --     Right functions -> return functions

  getContractsSymbols = undefined
  -- getContractsSymbols (ContractName contractName) addr = do
  --   conn <- asks dbConnection
  --   let
  --     encoder = contramap fst (Encoders.value Encoders.text)
  --       <> contramap snd (Encoders.value addressEncoder)
  --     decoder =
  --       Decoders.rowsList . Decoders.value $ SymbolName <$> Decoders.text
  --     sqlString =
  --       "SELECT XV.Name FROM contracts C\
  --       \ JOIN contracts_metadata CM ON CM.contract_id = C.id\
  --       \ JOIN contracts_instance CI ON CI.contract_metadata_id = CM.id\
  --       \ JOIN xabi_variables XV ON XV.contract_metadata_id = CM.id\
  --       \ WHERE C.name = $1 AND CI.address = $2"
  --     sqlStatement = statement sqlString encoder decoder False
  --   symbolsEither <- liftIO $
  --     run (query (contractName,addr) sqlStatement) conn
  --   case symbolsEither of
  --     Left err -> throwError $ DBError err
  --     Right symbols -> return symbols

  getContractsStateMapping = undefined
    -- (ContractName contractName) addr (SymbolName mapping) key = do
    --   conn <- asks dbConnection
    --   let
    --     encoder = contramap (\(a,_,_,_) -> a) (Encoders.value Encoders.text)
    --       <> contramap (\(_,b,_,_) -> b) (Encoders.value addressEncoder)
    --       <> contramap (\(_,_,c,_) -> c) (Encoders.value Encoders.text)
    --       <> contramap (\(_,_,_,d) -> d) (Encoders.value Encoders.text)
    --     decoder = _
    --     sqlString = "" -- fill in SQL here
    --     sqlStatement = statement sqlString encoder decoder False
    --   stateMappingResponseEither <- liftIO $
    --     run (query (contractName,addr,mapping,key) sqlStatement) conn
    --   case stateMappingResponseEither of
    --     Left err -> throwError $ DBError err
    --     Right stateMappingResponse -> return stateMappingResponse

  getContractsStates = undefined
  postContractsCompile = undefined
  -- postContractsCompile reqs = do
  --   conn <- asks dbConnection
  --   url <- asks urlStrato
  --   mgr <- asks httpManager
  --   let
  --     encoder = _
  --     decoder = _
  --     sqlString =
  --       ""
  --     sqlStatement = statement sqlString encoder decoder True
  --   for reqs $ \ PostCompileRequest
  --     { postcompilerequestSearchable = searchable
  --     , postcompilerequestContractName = contractName
  --     , postcompilerequestSource = source
  --     } -> do
  --       (xabi,comp) <- liftIO $ flip runClientM (ClientEnv mgr url) $
  --         (,) <$> postExtabi (Src source) <*> postSolc (Src source)
  --       return $ PostCompileResponse contractName _hash

type GetContracts = "contracts" :> Get '[JSON] (GetContractsResponse)
data AddressCreatedAt = AddressCreatedAt
  { createdAt :: Int64
  , address :: MaybeNamed Address
  } deriving (Eq, Show, Generic)
instance ToJSON AddressCreatedAt
instance FromJSON AddressCreatedAt
instance Arbitrary AddressCreatedAt where arbitrary = genericArbitrary
newtype GetContractsResponse = GetContractsResponse
  { unContracts :: Map Text [AddressCreatedAt] }
  deriving (Eq, Show, Generic)
instance ToJSON GetContractsResponse where
  toJSON = toJSON . unContracts
instance FromJSON GetContractsResponse where
  parseJSON = fmap GetContractsResponse . parseJSON
instance Arbitrary GetContractsResponse where arbitrary = genericArbitrary
instance ToSample GetContractsResponse where
  toSamples _ = singleSample $ GetContractsResponse $ Map.singleton "Sample"
    [ AddressCreatedAt
      { address = Unnamed $ Address 0x309e10eddc6333b82889bfc25a2b107b9c2c9a8c
      , createdAt = 100
      }
    , AddressCreatedAt
      { address = Named "Addressed"
      , createdAt = 101
      }
    ]

type GetContractsData = "contracts"
  :> Capture "contractName" ContractName
  :> Get '[OctetStream] [MaybeNamed Address]

-- GET /contracts/:contractName/:contractAddress.:extension? TODO: Check .extension
type GetContractsContract = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> Get '[HTMLifiedJSON] GetContractsContractResponse
data GetContractsContractResponse = GetContractsContractResponse
  { getcontractscontractresponseBin :: Text
  , getcontractscontractresponseAddress :: Maybe Address
  , getcontractscontractresponseBinRuntime :: Text
  , getcontractscontractresponseCodeHash :: Text
  , getcontractscontractresponseName :: Text
  , getcontractscontractresponseXabi :: Xabi
  } deriving (Show,Eq,Generic)
instance ToJSON GetContractsContractResponse where
  toJSON GetContractsContractResponse{..} = object
    [ "bin" .= getcontractscontractresponseBin
    , "address" .= getcontractscontractresponseAddress
    , "bin-runtime" .= getcontractscontractresponseBinRuntime
    , "codeHash" .= getcontractscontractresponseCodeHash
    , "name" .= getcontractscontractresponseName
    , "xabi" .= getcontractscontractresponseXabi
    ]
instance FromJSON GetContractsContractResponse where
  parseJSON = withObject "GetContractsContractResponse" $ \obj ->
    GetContractsContractResponse
      <$> obj .: "bin"
      <*> obj .:? "address"
      <*> obj .: "bin-runtime"
      <*> obj .: "codeHash"
      <*> obj .: "name"
      <*> obj .: "xabi"
instance ToSample GetContractsContractResponse where toSamples _ = noSamples
instance Arbitrary GetContractsContractResponse where
  arbitrary = genericArbitrary
data Xabi = Xabi
  { xabiFuncs :: Maybe (Map Text Func)
  , xabiConstr :: Maybe (Map Text Arg)
  , xabiVars :: Maybe (Map Text Var)
  } deriving (Eq,Show,Generic)
instance ToJSON Xabi where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Xabi where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Xabi where arbitrary = genericArbitrary
data Func = Func
  { funcArgs :: Map Text Arg
  , funcSelector :: Text
  , funcVals :: Map Text Val
  } deriving (Eq,Show,Generic)
instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Func where arbitrary = genericArbitrary
data Arg = Arg
  { argName :: Maybe Text
  , argType :: Text
  , argBytes :: Maybe Int
  , argIndex :: Int
  , argDynamic :: Maybe Bool
  , argEntry :: Maybe Entry
  , argTypedef :: Maybe Text
  } deriving (Eq,Show,Generic)
instance ToJSON Arg where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Arg where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Arg where arbitrary = genericArbitrary
data Entry = Entry
  { entryBytes :: Int
  , entryType :: Text
  } deriving (Eq,Show,Generic)
instance ToJSON Entry where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Entry where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Entry where arbitrary = genericArbitrary
data Val = Val
  { valType :: Text
  , valBytes :: Maybe Int
  , valIndex :: Int
  , valDynamic :: Maybe Bool
  , valEntry :: Maybe Entry
  , valTypedef :: Maybe Text
  } deriving (Eq,Show,Generic)
instance ToJSON Val where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Val where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Val where arbitrary = genericArbitrary
data Var = Var
  { varType :: Text
  , varBytes :: Maybe Int
  , varAtBytes :: Int
  , varDynamic :: Maybe Bool
  , varEntry :: Maybe Entry
  , varTypedef :: Maybe Text
  } deriving (Eq,Show,Generic)
instance ToJSON Var where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Var where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Var where arbitrary = genericArbitrary

type GetContractsState = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "state"
  :> Get '[JSON] GetContractsStateResponses -- change to HTML
type GetContractsStateResponses = Map Text SolidityValue -- Should be solidity values but we have problems with parsing, e.g. FromJSON with the current format
instance ToSample GetContractsStateResponses where toSamples _ = noSamples

-- GET /contracts/:contractName/:contractAddress/functions
type GetContractsFunctions = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "functions"
  :> Get '[HTMLifiedJSON] [FunctionName]
newtype FunctionName = FunctionName Text deriving (Eq,Show,Generic)
instance ToSample FunctionName where
  toSamples _ = samples
    [ FunctionName name | name <- ["functionCall1","functionCall2"]]
instance FromJSON FunctionName where
  parseJSON = fmap FunctionName . parseJSON
instance ToJSON FunctionName where
  toJSON (FunctionName name) = toJSON name
instance Arbitrary FunctionName where
  arbitrary = genericArbitrary

-- GET /contracts/:contractName/:contractAddress/symbols
type GetContractsSymbols = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "symbols"
  :> Get '[HTMLifiedJSON] [SymbolName]

-- GET /contracts/:contractName/:contractAddress/state/:mapping/:key
type GetContractsStateMapping = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "state"
  :> Capture "mapping" SymbolName
  :> Capture "key" Text
  :> Get '[JSON] GetContractsStateMappingResponse
instance ToCapture (Capture "key" Text) where
  toCapture _ = DocCapture "key" "a mapping key"
instance ToCapture (Capture "mapping" SymbolName) where
  toCapture _ = DocCapture "mapping" "the mapping's name"
type GetContractsStateMappingResponse =
  Map Text (Map Text SolidityValue)
instance ToSample GetContractsStateMappingResponse where
  toSamples _ = noSamples

-- GET /contracts/:contractName/all/states/
type GetContractsStates = "contracts"
  :> Capture "contractName" ContractName
  :> "all"
  :> "states"
  :> Get '[JSON] [GetContractsStatesResponse]
type GetContractsStatesResponse = Map Address (Map Text SolidityValue)
instance FromJSONKey Address where
  fromJSONKey = FromJSONKeyTextParser
    $ maybe (fail "could not decode address") return
    . stringAddress . Text.unpack
instance ToJSONKey Address where
  toJSONKey = ToJSONKeyText f g
    where f x = Text.pack $ addressString x
          g x = text . Text.pack $ addressString x
instance ToSample GetContractsStatesResponse where
  toSamples _ = noSamples

-- POST /contracts/compile
type PostContractsCompile = "contracts"
  :> "compile"
  :> ReqBody '[JSON] [PostCompileRequest]
  :> Post '[JSON] [PostCompileResponse]
data PostCompileRequest = PostCompileRequest
  { postcompilerequestSearchable :: [Text]
  , postcompilerequestContractName :: Text
  , postcompilerequestSource :: Text
  } deriving (Eq,Show,Generic)
instance Arbitrary PostCompileRequest where arbitrary = genericArbitrary
instance ToJSON PostCompileRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileRequest where
  toSamples _ = noSamples

data PostCompileResponse = PostCompileResponse
  { postcompileresponseContractName :: String
  , postcompileresponseCodeHash :: Keccak256
  } deriving (Eq,Show,Generic)
instance ToJSON PostCompileResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileResponse where
  toSamples _ = noSamples
instance Arbitrary PostCompileResponse where
  arbitrary = genericArbitrary

newtype SymbolName = SymbolName Text deriving (Eq,Show,Generic)
instance ToSample SymbolName where
  toSamples _ = samples
    [ SymbolName name | name <- ["variable1","variable2"]]
instance FromJSON SymbolName where parseJSON = fmap SymbolName . parseJSON
instance ToJSON SymbolName where toJSON (SymbolName name) = toJSON name
instance Arbitrary SymbolName where arbitrary = genericArbitrary
instance ToHttpApiData SymbolName where
  toUrlPiece (SymbolName name) = name
instance FromHttpApiData SymbolName where
  parseUrlPiece = Right . SymbolName

contractDecoder :: Decoders.Row AddressCreatedAt
contractDecoder = AddressCreatedAt
  <$> Decoders.value Decoders.int8
  <*> Decoders.value (Unnamed <$> addressDecoder <|> Named <$> Decoders.text)

data MaybeNamed a = Named Text | Unnamed a deriving (Eq,Show,Generic)
instance ToJSON a => ToJSON (MaybeNamed a) where
  toJSON (Named name) = toJSON name
  toJSON (Unnamed a) = toJSON a
instance FromJSON a => FromJSON (MaybeNamed a) where
  parseJSON x = Unnamed <$> parseJSON x <|> Named <$> parseJSON x
instance Arbitrary a => Arbitrary (MaybeNamed a) where
  arbitrary = oneof
    [ elements [Named "name1", Named "name2", Named "name3"]
    , Unnamed <$> arbitrary
    ]
instance ToHttpApiData (MaybeNamed Address) where
  toUrlPiece (Named name) = name
  toUrlPiece (Unnamed addr) = Text.pack . addressString $ addr
instance FromHttpApiData (MaybeNamed Address) where
  parseUrlPiece txt = case stringAddress (Text.unpack txt) of
    Nothing -> Right $ Named txt
    Just addr -> Right $ Unnamed addr
instance ToSample (MaybeNamed Address) where
  toSamples _ = [("Sample", Unnamed (Address 0xdeadbeef))]
instance ToCapture (Capture "contractAddress" (MaybeNamed Address)) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address or Contract Name"

data SolidityValue
  = SolidityValueAsString Text
  | SolidityBool Bool
  | SolidityArray [SolidityValue]
  | SolidityBytes  ByteString
  deriving (Eq,Show,Generic)
instance ToJSON SolidityValue where
  toJSON (SolidityValueAsString str) = toJSON str
  toJSON (SolidityBool bool) = toJSON bool
  toJSON (SolidityArray array) = toJSON array
  toJSON (SolidityBytes bytes) = object
    [ "type" .= ("Buffer" :: Text)
    , "data" .= ByteString.unpack bytes
    ]
instance FromJSON SolidityValue where
  parseJSON (String str) = return $ SolidityValueAsString str
  parseJSON (Bool bool) = return $ SolidityBool bool
  parseJSON (Array array) = SolidityArray <$> traverse parseJSON (toList array)
  parseJSON (Object obj) = do
    ty <- obj .: "type"
    if ty == ("Buffer" :: Text)
    then do
      bytes <- obj .: "data"
      return $ SolidityBytes (ByteString.pack bytes)
    else
      fail "Failed to parse SolidityBytes"
  parseJSON _ = fail "Failed to parse solidity value"
instance Arbitrary SolidityValue where
  arbitrary = genericArbitrary
