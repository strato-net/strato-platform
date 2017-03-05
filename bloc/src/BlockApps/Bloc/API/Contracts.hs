{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , LambdaCase
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Contracts where

import Control.Monad
import Control.Monad.IO.Class
import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Encoding
import qualified Data.ByteString as B
import Data.Int
import Data.Foldable
import Data.Traversable
import Data.Proxy
import Data.Time.Clock.POSIX
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Generic.Random.Generic
import GHC.Generics
import Hasql.Session
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Queries
import BlockApps.Ethereum
import BlockApps.Solidity
import BlockApps.SolidityVarReader
import BlockApps.Strato.Client
import BlockApps.Strato.Types


import DummyContractStorage

class Monad m => MonadContracts m where
  getContracts :: m GetContractsResponse
  getContractsData :: ContractName -> m [MaybeNamed Address]
  getContractsContract :: ContractName -> MaybeNamed Address -> m ContractDetails
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
  getContracts = blocSql $ do
    let
      -- current bloc returns milliseconds
      -- TODO: get those extra 3 significant figures of accuracy
      toMilliSec utc = truncate (utcTimeToPOSIXSeconds utc) * 1000
      addressToVal addr utc = AddressCreatedAt (toMilliSec utc) (Unnamed addr)
      addressesToMap = foldr'
        (\ (key,addr,utc) -> Map.insertWith (++) key [addressToVal addr utc])
        Map.empty
      nameToVal name utc = AddressCreatedAt (toMilliSec utc) (Named name)
      namesToMap = foldr'
        (\ (key,name,utc) -> Map.insertWith (++) key [nameToVal name utc])
        Map.empty
    contractsAddresses <- query () getContractsAddressesQuery
    contractsNamesAsAddresses <- query () getContractsNamesAsAddressesQuery
    return . GetContractsResponse $
      addressesToMap contractsAddresses
      `Map.union`
      namesToMap contractsNamesAsAddresses

  getContractsData (ContractName contractName) = blocSql $ do
    addresses <- query contractName getContractsDataAddressesQuery
    names <- query contractName getContractsDataNamesQuery
    return $ map Unnamed addresses ++ map Named names

  getContractsContract (ContractName contractName) contractId = blocSql $ do
    (contractDetails,metadataId) <- case contractId of
      Named "Latest" ->
        query contractName getContractsContractLatestQuery
      Unnamed addr ->
        query (contractName,addr) getContractsContractByAddressQuery
      Named name ->
        if contractName == name
          then query name getContractsContractBySameNameQuery
          else query (contractName,name) getContractsContractByNameQuery
    funcIdNameSels <- query metadataId getXabiFunctionsQuery
    let
      -- TODO: fix this in next API iteration
      argsToPairs = map (\ arg -> (fromMaybe "arggg" (argName arg), arg))
    funcs <- fmap Map.fromList $
      for funcIdNameSels $ \ (funcId,funcName,sel) -> do
        args <- query funcId getXabiFunctionsArgsQuery
        vals <- query funcId getXabiFunctionsReturnValuesQuery
        let
          func = Func
            { funcArgs = Map.fromList (argsToPairs args)
            , funcSelector = Text.decodeUtf8 sel
            , funcVals = Map.fromList vals
            }
        return $ (funcName,func)
    constrId <- query metadataId getXabiConstrQuery
    constr <- Map.fromList . argsToPairs <$>
      query constrId getXabiFunctionsArgsQuery
    vars <- Map.fromList <$> query metadataId getXabiVariablesQuery
    return $ contractDetails
      { contractdetailsXabi = Xabi (Just funcs) (Just constr) (Just vars) }

  getContractsState contractName contractId = do
    vars <- getVariablesAndTypes contractName contractId

    let url = BaseUrl Http "strato-ms-dev.eastus.cloudapp.azure.com" 80 "/strato-api/eth/v1.2"

    mgr <- liftIO $ newManager defaultManagerSettings
           
    storageOrError <-
      liftIO $ flip runClientM (ClientEnv mgr url) $ getStorage $ Just $ Address 0x953ac16faebbe2ce2136814cee884d82f0ecb1aa

    let storage' =
          case storageOrError of
           Left e -> error $ show e
           Right x -> x
           
    let storageMap = Map.fromList $ map (\Storage{..} -> (unHex storageKey, unHex storageValue)) storage'
    let storage k =
          case Map.lookup k storageMap of
           Just v -> v
           Nothing -> 0
           
        ret = map (\(position, var) -> fmap (valueToSolidityValue . decodeValue storage position) var) $ zip [0..] vars
    return $ Map.fromList ret

{-
/eth/v1.2/storage?minkey=0&maxkey=0&address=ea1827948bbcf15351d609a83dac48f5eae29eac

[
  {"value":"0000000000000000000000000000000000000000000000000000000000000011","address":"71a2b77372d87b99541701f72626de3f72cdb4ca","key":"0000000000000000000000000000000000000000000000000000000000000000"},
  {"value":"000000000000000000000000000000000000000000000000000000000000000b","address":"7372d2241e0d5cb9c4ed0de0eb3588a5ae5bae10","key":"eb0af23d6bac7d94dd2ccf7fb17952ea9fb390eee52503b3e8463b2c96c2503e"}]
-}

  getContractsFunctions (ContractName contractName) contractId = blocSql $ do
    metadataId <- case contractId of
      Named "Latest" ->
        query contractName getContractMetaDataIdByLatestQuery
      Unnamed addr ->
        query (contractName,addr) getContractsMetaDataIdByAddressQuery
      Named name ->
        if contractName == name
          then query name getContractMetaDataIdBySameNameQuery
          else query (contractName,name) getContractsMetaDataIdByNameQuery
    funcIdNameSels <- query metadataId getXabiFunctionsQuery
    return $ map (\ (_, funcName, _) -> FunctionName funcName) funcIdNameSels



  getContractsSymbols (ContractName contractName) contractId = blocSql $ do
    metadataId <- case contractId of
      Named "Latest" ->
        query contractName getContractMetaDataIdByLatestQuery
      Unnamed addr ->
        query (contractName,addr) getContractsMetaDataIdByAddressQuery
      Named name ->
        if contractName == name
          then query name getContractMetaDataIdBySameNameQuery
          else query (contractName,name) getContractsMetaDataIdByNameQuery
    vars <- query metadataId getXabiVariablesQuery
    return $ map (\ (varName, _) -> SymbolName varName) vars

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

  -- postContractsCompile = undefined

  postContractsCompile = traverse $ \ PostCompileRequest
    { postcompilerequestSearchable = searchable -- TODO: Support Cirrus here
    , postcompilerequestContractName = contractName
    , postcompilerequestSource = source
    } -> do
      (ExtabiResponse xabis,SolcResponse abiBins) <- blocStrato $
        (,) <$> postExtabi (Src source) <*> postSolc (Src source)
      let
        contracts = Map.intersectionWith (,) xabis abiBins
      metaDataIds <- forMap contracts $ \ contrName (Xabi{..},AbiBin{..}) -> do
        let
          codeHash = undefined
          binRuntimeHash = undefined
        blocSql $ do
          contrId <- query contractName createContractQuery
          metaDataId <- query
            (contrId,bin,binRuntime,codeHash,binRuntimeHash)
            upsertContractMetaDataQuery
          for_ xabiFuncs $ \ funcs ->
            forMap_ funcs $ \ funcName Func{..} -> do
              funcId <- query
                (metaDataId,funcName,funcSelector,False)
                insertXabiFunction
              -- flip Map.traverseWithKey funcArgs $ \ argName arg ->
              return ()
          return metaDataId
      for_ metaDataIds $ \ leftMetaDataId ->
        for_ metaDataIds $ \ rightMetaDataId -> blocSql $
          --  unless (leftMetaDataId == rightMetaDataId) $
          -- TODO: Remove all same name queries and logic
             query (leftMetaDataId,rightMetaDataId) insertContractLookup
      let contractCodeHash = undefined
      return $ PostCompileResponse contractName contractCodeHash

type GetContracts = "contracts" :> Get '[JSON] GetContractsResponse
data AddressCreatedAt = AddressCreatedAt
  { createdAt :: Int64
  , address :: MaybeNamed Address
  } deriving (Eq, Show, Generic)
instance ToJSON AddressCreatedAt
instance FromJSON AddressCreatedAt
instance Arbitrary AddressCreatedAt where arbitrary = genericArbitrary uniform
newtype GetContractsResponse = GetContractsResponse
  { unContracts :: Map Text [AddressCreatedAt] }
  deriving (Eq, Show, Generic)
instance ToJSON GetContractsResponse where
  toJSON = toJSON . unContracts
instance FromJSON GetContractsResponse where
  parseJSON = fmap GetContractsResponse . parseJSON
instance Arbitrary GetContractsResponse where arbitrary = genericArbitrary uniform
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
  :> Get '[HTMLifiedJSON] ContractDetails

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
  arbitrary = genericArbitrary uniform

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
instance Arbitrary PostCompileRequest where arbitrary = genericArbitrary uniform
instance ToJSON PostCompileRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileRequest where
  toSamples _ = noSamples

data PostCompileResponse = PostCompileResponse
  { postcompileresponseContractName :: Text
  , postcompileresponseCodeHash :: Keccak256
  } deriving (Eq,Show,Generic)
instance ToJSON PostCompileResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileResponse where
  toSamples _ = noSamples
instance Arbitrary PostCompileResponse where
  arbitrary = genericArbitrary uniform

newtype SymbolName = SymbolName Text deriving (Eq,Show,Generic)
instance ToSample SymbolName where
  toSamples _ = samples
    [ SymbolName name | name <- ["variable1","variable2"]]
instance FromJSON SymbolName where parseJSON = fmap SymbolName . parseJSON
instance ToJSON SymbolName where toJSON (SymbolName name) = toJSON name
instance Arbitrary SymbolName where arbitrary = genericArbitrary uniform
instance ToHttpApiData SymbolName where
  toUrlPiece (SymbolName name) = name
instance FromHttpApiData SymbolName where
  parseUrlPiece = Right . SymbolName

-- helper functions
forMap :: Applicative m => Map k v -> (k -> v -> m x) -> m (Map k x)
forMap m act = Map.traverseWithKey act m

forMap_ :: Applicative m => Map k v -> (k -> v -> m ()) -> m ()
forMap_ m act = void $ forMap m act
