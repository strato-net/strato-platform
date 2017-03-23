{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    Arrows
  , DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
  , ScopedTypeVariables
  , TupleSections
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Contracts where

import Control.Arrow
import Control.Monad.Except
import Control.Monad.Log
import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Encoding
import Data.Foldable
import Data.Int
import Data.Maybe
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Monoid
import Data.Proxy
import Data.String
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Data.Time.Clock.POSIX
import Data.Traversable
import Generic.Random.Generic
import GHC.Generics
import Numeric
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Database.Queries
import BlockApps.Bloc.Monad
import BlockApps.Ethereum
import BlockApps.Solidity
import BlockApps.SolidityVarReader
import BlockApps.Strato.Client
import BlockApps.Strato.Types

import BlockApps.Bloc.DummyContractStorage

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
  getContracts = do
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
    contractsAddresses <- blocQuery getContractsAddressesQuery
    contractsNamesAsAddresses <- blocQuery getContractsNamesAsAddressesQuery
    return . GetContractsResponse $
      addressesToMap contractsAddresses
      `Map.union`
      namesToMap contractsNamesAsAddresses

  getContractsData (ContractName contractName) = do
    addresses <- blocQuery $ getContractsDataAddressesQuery contractName
    names <- blocQuery $ getContractsDataNamesQuery contractName
    return $ map Unnamed addresses ++ map Named names

  getContractsContract (ContractName contractName) contractId = do
    let
      noXabi = Xabi Nothing Nothing Nothing
      detailsWith detailsAddr (bin,binRuntime,codeHash,name) =
        ContractDetails
          { contractdetailsBin = Text.decodeUtf8 bin
          , contractdetailsAddress = detailsAddr
          , contractdetailsBinRuntime = Text.decodeUtf8 binRuntime
          , contractdetailsCodeHash = Text.decodeUtf8 codeHash
          , contractdetailsName = name
          , contractdetailsXabi = noXabi
          }
    contractDetails <- case contractId of
      Named "Latest" -> do
        tuple <- blocQuery1 $
          getContractsContractLatestQuery contractName
        return $ detailsWith Nothing tuple
      Unnamed addr -> do
        (addr',tuple) <- blocQuery1 $
          getContractsContractByAddressQuery contractName addr
        return $ detailsWith (Just (Unnamed addr')) tuple
      Named name -> if contractName == name
        then do
          tuple <- blocQuery1 $
            getContractsContractBySameNameQuery name
          return $ detailsWith (Just (Named name)) tuple
        else do
          tuple <- blocQuery1 $
            getContractsContractByNameQuery contractName name
          return $ detailsWith (Just (Named name)) tuple
    metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
    funcIdNameSelsMaybe <- blocQuery $ getXabiFunctionsQuery metadataId
    let
      -- TODO: fix this in next API iteration
      funcIdNameSels =
        [ (funcId, funcName, sel)
        | (funcId, Just funcName, Just sel) <- funcIdNameSelsMaybe
        ]
      argsToPairs = map (\ arg -> (argName arg, arg))
    funcs <- fmap Map.fromList $
      for funcIdNameSels $ \ (funcId,funcName,sel) -> do
        args <- do
          tuples <- blocQuery (getXabiFunctionsArgsQuery funcId)
          for tuples $ \ (name,index,ty,tyd,dy,by,ety,eby) ->
            return Arg
              { argName = name
              , argIndex = index
              , argType = ty
              , argTypedef = tyd
              , argDynamic = dy
              , argBytes = by
              , argEntry = Entry <$> eby <*> ety
              }
        vals <- do
          tuples <- blocQuery (getXabiFunctionsReturnValuesQuery funcId)
          for tuples $ \ (_::Int32,index,ty,tyd,dy,by,ety,eby) ->
            return $ ("#" <> Text.pack (show index),) Val
              { valIndex = index
              , valType = ty
              , valTypedef = tyd
              , valDynamic = dy
              , valBytes = by
              , valEntry = Entry <$> eby <*> ety
              }
        let
          func = Func
            { funcArgs = Map.fromList (argsToPairs args)
            , funcSelector = Text.decodeUtf8 sel
            , funcVals = Map.fromList vals
            }
        return (funcName,func)
    constrId <- blocQuery1 $ getXabiConstrQuery metadataId
    constr <- Map.fromList . argsToPairs <$> do
      tuples <- blocQuery (getXabiFunctionsArgsQuery constrId)
      for tuples $ \ (name,index,ty,tyd,dy,by,ety,eby) ->
        return Arg
          { argName = name
          , argIndex = index
          , argType = ty
          , argTypedef = tyd
          , argDynamic = dy
          , argBytes = by
          , argEntry = Entry <$> eby <*> ety
          }
    vars <- Map.fromList <$> do
      tuples <- blocQuery (getXabiVariablesQuery metadataId)
      for tuples $ \ (name,atBy,ty,tyd,dy,si,by,ety,eby,vty,vby,vdy,vsi,vety,veby,kty,kby,kdy,ksi,kety,keby) ->
        return $ (name,) Var
          { varAtBytes = atBy
          , varType = Just ty
          , varTypedef = Just tyd
          , varDynamic = Just dy
          , varSigned = Just si
          , varBytes = Just by
          , varEntry = Entry <$> Just eby <*> Just ety
          , varVal = Just SimpleVar
            { simplevarType = vty
            , simplevarBytes = Just vby
            , simplevarDynamic = Just vdy
            , simplevarSigned = Just vsi
            , simplevarEntry = Entry <$> Just veby <*> Just vety
            }
          , varKey = Just SimpleVar
            { simplevarType = kty
            , simplevarBytes = Just kby
            , simplevarDynamic = Just kdy
            , simplevarSigned = Just ksi
            , simplevarEntry = Entry <$> Just keby <*> Just kety
            }
          }
    return $ contractDetails
      { contractdetailsXabi = Xabi (Just funcs) (Just constr) (Just vars) }

  getContractsState contractName contractId = do
    contract <- getContract contractName contractId

    storage' <- blocStrato $ getStorage $ Just $ getAddress contractName contractId

    let storageMap = Map.fromList $ map (\Storage{..} -> (unHex storageKey, unHex storageValue)) storage'
        storage k = fromMaybe 0 $ Map.lookup k storageMap


        ret = map (fmap valueToSolidityValue) $ decodeValues contract storage

    logNotice . withCallStack =<< timestamp
      ( Text.unlines
        [ "Storage:"
        , Text.pack $ unlines $ map (\(k, v) -> "  " ++ show k ++ ":" ++ showHex v "") $ Map.toList storageMap
        , "End of storage"
        ]
      )

    return $ Map.fromList ret

  getContractsFunctions (ContractName contractName) contractId = do
    metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
    funcNames <- blocQuery $ proc () -> do
      (_,funcName,_) <- getXabiFunctionsQuery metadataId -< ()
      returnA -< funcName
    return [FunctionName funcName | Just funcName <- funcNames]

  getContractsSymbols (ContractName contractName) contractId = do
    metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
    vars <- blocQuery $ proc () -> do
      (varName,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_) <-
        getXabiVariablesQuery metadataId -< ()
      returnA -< varName
    return $ map SymbolName vars

  getContractsStateMapping _ _ _ _ = throwError Unimplemented

  getContractsStates _ = throwError Unimplemented

  -- postContractsCompile = undefined

  postContractsCompile = traverse $ \ PostCompileRequest
    { postcompilerequestSearchable = _searchable -- TODO: Support Cirrus here
    , postcompilerequestContractName = contractName
    , postcompilerequestSource = source
    } -> do
      codeHash <- compileContract contractName source
      return $ PostCompileResponse contractName codeHash

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
instance IsString SymbolName where
  fromString = SymbolName . Text.pack
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
