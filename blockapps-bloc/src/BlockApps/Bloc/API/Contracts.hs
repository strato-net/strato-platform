{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Contracts where

import Control.Applicative
import Control.Monad.Except
import Control.Monad.Reader
import Data.Aeson
import Data.Aeson.Casing
import qualified Data.Aeson.Types as JSON (fieldLabelModifier)
import Data.Functor.Contravariant
import Data.Int
import Data.Monoid
import Data.Proxy
import Data.Text (Text)
-- import Data.Traversable
import Generic.Random.Generic
import GHC.Generics
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Hasql.Query
import Hasql.Session
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data
-- import BlockApps.Strato.API.Client
-- import BlockApps.Strato.Types hiding (Contract)

class Monad m => MonadContracts m where
  getContracts :: m Contracts
  getContractsData :: ContractName -> m [Address]
  getContractsContract :: ContractName -> Address -> m UnstructuredJSON
  getContractsState :: ContractName -> Address -> m UnstructuredJSON -- state-translation
  getContractsFunctions :: ContractName -> Address -> m [FunctionName]
  getContractsSymbols :: ContractName -> Address -> m [SymbolName]
  getContractsStateMapping :: ContractName -> Address -> SymbolName -> Text -> m UnstructuredJSON -- state-translation
  getContractsStates :: ContractName -> m UnstructuredJSON -- state-translation
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

  getContracts = do
    conn <- asks dbConnection
    let
      encoder = Encoders.unit
      decoder = Decoders.rowsList contractDecoder
      sqlString = "SELECT address, timestamp FROM contracts_instance;"
      sqlStatement = statement sqlString encoder decoder False
    contractsEither <- liftIO $ run (query () sqlStatement) conn
    case contractsEither of
      Left err -> throwError $ DBError err
      Right cons -> return $ Contracts cons

  getContractsData (ContractName contractName) = do
    conn <- asks dbConnection
    let
      encoder = Encoders.value Encoders.text
      decoder = Decoders.rowsList (Decoders.value addressDecoder)
      sqlString =
        "SELECT CI.address\
        \ FROM contracts C JOIN contracts_metadata CM\
        \ ON CM.contract_id = C.id\
        \ JOIN contracts_instance CI\
        \ ON CI.contract_metadata_id = CM.id\
        \ WHERE C.name = $1;"
      sqlStatement = statement sqlString encoder decoder False
    addressesEither <- liftIO $
      run (query contractName sqlStatement) conn
    case addressesEither of
      Left err -> throwError $ DBError err
      Right addresses -> return addresses

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
  --     -- GET function arguments
  --     sqlStringArgs =
  --       "SELECT XFP.name, XFP.type, XFP.index, XFP.bytes, XFP.is_dynamic\
  --       \ FROM xabi_functions XF\
  --       \ LEFT OUTER JOIN xabi_function_parameters XFP\
  --       \ ON XFP.function_id = XF.id\
  --       \ WHERE XF.id = $1 AND NOT XFP.is_return_type"
  --     -- GET function return types
  --     sqlStringRet =
  --       "SELECT XFP.name, XFP.type, XFP.index, XFP.bytes, XFP.is_dynamic\
  --       \ FROM xabi_functions XF\
  --       \ LEFT OUTER JOIN xabi_function_parameters XFP\
  --       \ ON XFP.function_id = XF.id\
  --       \ WHERE XF.id = $1 AND XFP.is_return_type"
  --     -- GET Constructor
  --     sqlStringConstr =
  --       "SELECT XF.id, XF.name, XF.selector\
  --       \ FROM contracts C\
  --       \ JOIN contracts_metadata CM ON CM.contract_id = C.id\
  --       \ JOIN contracts_instance CI ON CI.contract_metadata_id = CM.id\
  --       \ JOIN xabi_functions XF ON XF.contract_metadata_id = CM.id\
  --       \ WHERE C.name = $1 AND CI.address = $2 AND XF.is_constructor"
  --     -- GET Variables
  --     sqlStringVars =
  --       "SELECT XV.id, XV.name, XV.type, XV.bytes, XV.at_bytes, XV.is_dynamic\
  --       \ FROM contracts C\
  --       \ JOIN contracts_metadata CM ON CM.contract_id = C.id\
  --       \ JOIN contracts_instance CI ON CI.contract_metadata_id = CM.id\
  --       \ JOIN xabi_variables XV ON XV.contract_metadata_id = CM.id\
  --       \ WHERE C.name = $1 AND CI.address = $2"
  --     -- GET Variable Entry
  --     sqlStringVarEnt =
  --       "SELECT XCE.typedef, XCE.type, XCE.bytes\
  --       \ FROM xabi_complex_entries XCE\
  --       \ WHERE XCE.id = $1"
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

  getContractsFunctions (ContractName contractName) addr = do
    conn <- asks dbConnection
    let
      encoder = contramap fst (Encoders.value Encoders.text)
        <> contramap snd (Encoders.value addressEncoder)
      decoder =
        Decoders.rowsList . Decoders.value $ FunctionName <$> Decoders.text
      sqlString =
        "SELECT XF.Name FROM contracts C\
        \ JOIN contracts_metadata CM ON CM.contract_id = C.id\
        \ JOIN contracts_instance CI ON CI.contract_metadata_id = CM.id\
        \ JOIN xabi_functions XF ON XF.contract_metadata_id = CM.id\
        \ WHERE C.name = $1 AND CI.address = $2 AND NOT XF.is_constructor"
      sqlStatement = statement sqlString encoder decoder False
    functionsEither <- liftIO $
      run (query (contractName,addr) sqlStatement) conn
    case functionsEither of
      Left err -> throwError $ DBError err
      Right functions -> return functions

  getContractsSymbols (ContractName contractName) addr = do
    conn <- asks dbConnection
    let
      encoder = contramap fst (Encoders.value Encoders.text)
        <> contramap snd (Encoders.value addressEncoder)
      decoder =
        Decoders.rowsList . Decoders.value $ SymbolName <$> Decoders.text
      sqlString =
        "SELECT XV.Name FROM contracts C\
        \ JOIN contracts_metadata CM ON CM.contract_id = C.id\
        \ JOIN contracts_instance CI ON CI.contract_metadata_id = CM.id\
        \ JOIN xabi_variables XV ON XV.contract_metadata_id = CM.id\
        \ WHERE C.name = $1 AND CI.address = $2"
      sqlStatement = statement sqlString encoder decoder False
    symbolsEither <- liftIO $
      run (query (contractName,addr) sqlStatement) conn
    case symbolsEither of
      Left err -> throwError $ DBError err
      Right symbols -> return symbols

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

type GetContracts = "contracts" :> Get '[JSON] Contracts
data Contract = Contract
  { createdAt :: Int64
  , address :: MaybeNamed Address
  } deriving (Eq, Show, Generic)
instance ToJSON Contract
instance FromJSON Contract
instance Arbitrary Contract where arbitrary = genericArbitrary
newtype Contracts = Contracts
  { contracts :: [Contract] } deriving (Eq, Show, Generic)
instance ToJSON Contracts where
  toJSON = genericToJSON defaultOptions
    {JSON.fieldLabelModifier = const "Address"}
instance FromJSON Contracts where
  parseJSON = genericParseJSON defaultOptions
    {JSON.fieldLabelModifier = const "Address"}
instance Arbitrary Contracts where arbitrary = genericArbitrary
instance ToSample Contracts where
  toSamples _ = singleSample $ Contracts
    [ Contract
      { address = Unnamed $ Address 0x309e10eddc6333b82889bfc25a2b107b9c2c9a8c
      , createdAt = 100
      }
    , Contract
      { address = Named "Addressed"
      , createdAt = 101
      }
    ]

type GetContractsData = "contracts"
  :> Capture "contractName" ContractName
  :> Get '[OctetStream] [Address]

-- GET /contracts/:contractName/:contractAddress.:extension? TODO: Check .extension
type GetContractsContract = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> Get '[JSON] UnstructuredJSON

type GetContractsState = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "state"
  :> Get '[JSON] UnstructuredJSON -- change to HTML

-- GET /contracts/:contractName/:contractAddress/functions
type GetContractsFunctions = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
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
  :> Capture "contractAddress" Address
  :> "symbols"
  :> Get '[JSON] [SymbolName]

-- GET /contracts/:contractName/:contractAddress/state/:mapping/:key
type GetContractsStateMapping = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "state"
  :> Capture "mapping" SymbolName
  :> Capture "key" Text
  :> Get '[JSON] UnstructuredJSON
instance ToCapture (Capture "key" Text) where
  toCapture _ = DocCapture "key" "a mapping key"
instance ToCapture (Capture "mapping" SymbolName) where
  toCapture _ = DocCapture "mapping" "the mapping's name"

-- GET /contracts/:contractName/all/states/
type GetContractsStates = "contracts"
  :> Capture "contractName" ContractName
  :> "all"
  :> "states"
  :> Get '[JSON] UnstructuredJSON

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

contractDecoder :: Decoders.Row Contract
contractDecoder = Contract
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
