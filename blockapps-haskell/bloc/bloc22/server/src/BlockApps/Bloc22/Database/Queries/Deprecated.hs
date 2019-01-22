{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE Arrows                #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TupleSections         #-}

module BlockApps.Bloc22.Database.Queries.Deprecated where

import           ClassyPrelude                   ((<>))
import           Control.Arrow
import           Control.Concurrent              (threadDelay)
import           Control.Monad
import           Control.Monad.Except
import           Crypto.Hash
import qualified Crypto.Saltine.Class            as Saltine
import qualified Crypto.Saltine.Core.SecretBox   as SecretBox
import           Crypto.Secp256k1
import           Data.Aeson                      (Result(..), fromJSON, decode, encode)
import qualified Data.ByteArray                  as ByteArray
import           Data.ByteString                 (ByteString)
import qualified Data.ByteString                 as BS
import qualified Data.ByteString.Char8           as Char8
import           Data.ByteString.Lazy            (fromStrict, toStrict)
import           Data.Int                        (Int32)
import           Data.Map.Strict                 (Map)
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Profunctor
import           Data.Profunctor.Product.Default
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import qualified Data.Text.Encoding              as Text
import           Data.Traversable
import           Database.PostgreSQL.Simple      (Connection)
import           GHC.Stack
import           Opaleye                         hiding (not, null, index)
import qualified Opaleye                         (not)


import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Database.Solc
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.SolidityVarReader     (byteStringToWord256, word256ToByteString)
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Parse.Parser
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Def     as Xabi.Def
import qualified BlockApps.Solidity.Xabi.Type    as Xabi
import           BlockApps.Strato.Types
import           BlockApps.XAbiConverter

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

{- |
SELECT
  XF.id
 ,XF.name
 ,XF.selector
FROM xabi_functions XF
WHERE XF.is_constructor = false AND XF.contract_metadata_id = $1;
-}
getXabiFunctionsQuery :: HasCallStack =>
                         Int32 -> Bloc (Map Text Func)
getXabiFunctionsQuery cmId = do
  funcsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (xfId,contractmetadataId,isConstr,name,mut) <-
      queryTable xabiFunctionsTable -< ()
    restrict -< contractmetadataId .== constant cmId .&& Opaleye.not isConstr
    returnA -< (name,(xfId, mut))
  for funcsWithIds $ \ (xfId, mut) -> do --TODO remove the selector from the DB
    args <- getXabiFunctionsArgsQuery xfId
    let
      valMap valList = Map.fromList
        [ ( "#" <> Text.pack (show (Xabi.indexedTypeIndex val)), val)
        | val <- valList
        ]
    vals <- valMap <$> getXabiFunctionsReturnValuesQuery xfId
    return  Func { funcArgs = args
                 , funcVals = vals
                 , funcContents = Nothing
                 , funcStateMutability = mut
                 , funcVisibility = Nothing
                 , funcModifiers = Nothing
                 }

{- |
SELECT
  XF.id
 ,XF.name
 ,XF.selector
FROM xabi_functions XF
WHERE XF.is_constructor = false AND XF.contract_metadata_id = $1;
-}
getXabiConstrQuery :: HasCallStack =>
                         Int32 -> Bloc (Maybe Func)
getXabiConstrQuery cmId = do
  funcsWithIds <- blocQueryMaybe $ proc () -> do
    (xfId,contractmetadataId,isConstr,name, _) <-
      queryTable xabiFunctionsTable -< ()
    restrict -< contractmetadataId .== constant cmId .&& isConstr
    returnA -< (name,xfId)
  for funcsWithIds $ \(_ :: Text, xfId) -> do
    args <- getXabiFunctionsArgsQuery xfId
    let
      valMap valList = Map.fromList
        [ ( "#" <> Text.pack (show (Xabi.indexedTypeIndex val)), val)
        | val <- valList
        ]
    vals <- valMap <$> getXabiFunctionsReturnValuesQuery xfId
    return $ Func { funcArgs = args
                  , funcVals = vals
                  , funcStateMutability = Nothing
                  , funcContents = Nothing
                  , funcVisibility = Nothing
                  , funcModifiers = Nothing
                  }

{- |
SELECT
  ,XFA.name
  ,XFA.index
  ,XT.type
  ,XT.typedef
  ,XT.is_dynamic
  ,XT.bytes
  ,XTE.type as entry_type
  ,XTE.bytes as entry_bytes
FROM xabi_function_arguments XFA
JOIN xabi_types XT
  ON XT.id = XFA.type_id
LEFT OUTER JOIN xabi_types XTE
  ON XTE.id = XT.entry_type_id
WHERE XFA.function_id = $1;
-}
getXabiFunctionsArgsQuery
  :: Int32
  -> Bloc (Map Text Xabi.IndexedType)
getXabiFunctionsArgsQuery funcId = do
  argsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (_,functionId,tyid,name,index) <-
      queryTable xabiFunctionArgumentsTable -< ()
    restrict -< functionId .== constant funcId
    returnA -< (name,(index,tyid))
  for argsWithIds $ \ (index,tyid) -> do
    ty <- getXabiType tyid
    return $ Xabi.IndexedType index ty

{- |
SELECT
  (CASE WHEN XFR.name IS NULL THEN '#' + CAST(XFR.index AS VARCHAR(20)) ELSE XFR.name END) as name
  ,XFR.index
  ,XT.type
  ,XT.typedef
  ,XT.is_dynamic
  ,XT.bytes
  ,XTE.type as entry_type
  ,XTE.bytes as entry_bytes
FROM xabi_function_return XFR
JOIN xabi_types XT
  ON XT.id = XFR.type_id
LEFT OUTER JOIN xabi_types XTE
  ON XTE.id = XT.entry_type_id
WHERE XFR.function_id = $1;"
-}
getXabiFunctionsReturnValuesQuery :: HasCallStack =>
                                     Int32 -> Bloc [Xabi.IndexedType]
getXabiFunctionsReturnValuesQuery funcId = do
  valsWithIds <- blocQuery $ proc () -> do
    (_,functionId,index,tyid) <-
      queryTable xabiFunctionReturnsTable -< ()
    restrict -< functionId .== constant funcId
    returnA -< (index,tyid)
  for valsWithIds $ \ (index,tyid) -> do
    ty <- getXabiType tyid
    return $ Xabi.IndexedType index ty

{- |
SELECT
   XV.name
  ,XV.at_bytes
  ,XV.type_id
FROM
  xabi_variables XV
WHERE XV.contract_metadata_id = $1;
-}
getXabiVariablesQuery :: Int32 -> Bloc (Map Text Xabi.VarType)
getXabiVariablesQuery cmId = do
  varsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (_,cmid,typeid,name,atbytes,ispublic,isconstant,value)
      <- queryTable xabiVariablesTable -< ()
    restrict -< cmid .== constant cmId
    returnA -< (name,(atbytes,ispublic,isconstant,value,typeid))
  for varsWithIds $ \ (atbytes,ispublic,isconstant, value,typeid) -> do
    ty <- getXabiType typeid
    return $ Xabi.VarType atbytes (Just ispublic) (Just isconstant) value ty

instance QueryRunnerColumnDefault PGBytea Address where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode address") . stringAddress . Char8.unpack)
    queryRunnerColumnDefault
instance Default Constant Address (Column PGBytea) where
  def = lmap (Char8.pack . addressString) def

instance QueryRunnerColumnDefault PGBytea SecretBox.Nonce where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode nonce") . Saltine.decode)
    queryRunnerColumnDefault
instance Default Constant SecretBox.Nonce (Column PGBytea) where
  def = lmap Saltine.encode def

instance Default Constant PubKey (Column PGBytea) where
  def = lmap (exportPubKey False) def

instance QueryRunnerColumnDefault PGBytea PubKey where
  queryRunnerColumnDefault =
     queryRunnerColumn id toPubKey queryRunnerColumnDefault
     where toPubKey :: ByteString -> PubKey
           toPubKey = fromMaybe (error "could not import pubkey") . importPubKey

instance Default Constant UserName (Column PGText) where
  def = lmap getUserName def

instance Default Constant StateMutability (Column PGText) where
  def = lmap tShow def

instance QueryRunnerColumnDefault PGText StateMutability where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode mutability") . tRead)
    queryRunnerColumnDefault

instance QueryRunnerColumnDefault PGBytea Keccak256 where
  queryRunnerColumnDefault =
    queryRunnerColumn id toKecc queryRunnerColumnDefault
    where
      toKecc :: ByteString -> Keccak256
      toKecc
        = Keccak256
        . fromMaybe (error "could not decode hash")
        . digestFromByteString

instance Default Constant Keccak256 (Column PGBytea) where
  def = lmap fromKecc def
    where
      fromKecc :: Keccak256 -> ByteString
      fromKecc (Keccak256 digest) = ByteArray.convert digest

instance QueryRunnerColumnDefault PGBytea (Maybe ChainId) where
  queryRunnerColumnDefault =
    queryRunnerColumn id toChainId queryRunnerColumnDefault
    where
      toChainId :: ByteString -> Maybe ChainId
      toChainId bs
        = if BS.null bs
            then Nothing
            else Just
               . ChainId
               . byteStringToWord256
               $ bs

instance Default Constant (Maybe ChainId) (Column PGBytea) where
  def = lmap fromChainId def
        where fromChainId = \case
                Nothing -> BS.empty
                Just cid -> word256ToByteString $ unChainId cid

getXabiType :: HasCallStack =>
               Int32 -> Bloc Xabi.Type
getXabiType typeId = do
  (xtty,xttd,xtdy,xtsi,xtby,xtlen,xtetid,xtvtid,xtktid)
    <- blocQuery1 "getXabiType" $ proc () -> do
      (xtid,xtty,xttd,xtdy,xtsi,xtby,xtlen,xtet,xtvt,xtkt)
        <- queryTable xabiTypesTable -< ()
      restrict -< xtid .== constant typeId
      returnA -< (xtty,xttd,xtdy,xtsi,xtby,xtlen,xtet,xtvt,xtkt)
  case xtty::Text of
    "Int" ->
      return $ Xabi.Int (Just xtsi) xtby
    "String" ->
      return $ Xabi.String (Just xtdy)
    "Bytes" ->
      return $ Xabi.Bytes (Just xtdy) xtby
    "Bool" ->
      return Xabi.Bool
    "Address" ->
      return Xabi.Address
    "Struct" -> do
      xttd' <- blocMaybe "Missing typedef in type Struct" xttd
      return $ Xabi.Struct xtby xttd'
    "Enum" -> do
      xttd' <- blocMaybe "Missing typedef in type Enum" xttd
      return $ Xabi.Enum xtby xttd' Nothing
    "Array" -> do
      xtetid' <- blocMaybe "Missing entry type id in type Array" xtetid
      xtet <- getXabiType xtetid'
      return $ Xabi.Array xtet (fmap fromIntegral (xtlen :: Maybe Int32))
    "Contract" -> do
      xttd' <- blocMaybe "Missing typedef in type Struct" xttd
      return $ Xabi.Contract xttd'
    "Mapping" -> do
      xtktid' <- blocMaybe "Missing key type id in type Mapping" xtktid
      xtvtid' <- blocMaybe "Missing value type id in type Mapping" xtvtid
      xtkt <- getXabiType xtktid'
      xtvt <- getXabiType xtvtid'
      return $ Xabi.Mapping (Just xtdy) xtkt xtvt
    "Label" -> do
      xttd' <- blocMaybe "Missing typedef in type Enum" xttd
      return $ Xabi.Label $ Text.unpack xttd'
    _ -> throwError $ DBError "Could not match type"

getXabiStructFields :: Int32 -> Bloc [(Text, Xabi.FieldType)]
getXabiStructFields typeDefId = do
  fieldsWithIds <- blocQuery $ proc () -> do
    (_,name,atbytes,tdid,ftid)
      <- queryTable xabiStructFieldsTable -< ()
    restrict -< tdid .== constant typeDefId
    returnA -< (name,(atbytes,ftid))
  for fieldsWithIds $ \ (name,(atbytes,ftid)) -> do
    ty <- getXabiType ftid
    return (name, Xabi.FieldType atbytes ty)

getXabiEnumNames :: Int32 -> Bloc [Text]
getXabiEnumNames typeDefId = blocQuery $ proc () -> do
  (_,name,_,tdid) <-
    orderBy (asc (\ (_,_,value,_) -> value))
      (queryTable xabiEnumNamesTable) -< ()
  restrict -< tdid .== constant typeDefId
  returnA -< name

getXabiTypeDefs :: Int32 -> Bloc (Map Text Xabi.Def.Def)
getXabiTypeDefs metadataId = do
  typedefsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (tdid,name,cmid,ty,by) <- queryTable xabiTypeDefsTable -< ()
    restrict -< cmid .== constant metadataId
    returnA -< (name,(tdid,ty,by))
  for typedefsWithIds $ \ (tdid,ty,by::Int32) -> case ty of
      "Struct" -> do
        fields <- getXabiStructFields tdid
        return $ Xabi.Def.Struct fields (fromIntegral by)
      "Enum" -> do
        names <- getXabiEnumNames tdid
        return $ Xabi.Def.Enum names (fromIntegral by)
      "Contract" ->
        return $ Xabi.Def.Contract $ fromIntegral by
      _ -> throwError $ DBError $
        "Invalid type def. Expected Struct or Enum, saw " <> ty

getContractXabiDeprecated :: HasCallStack =>
                   ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc Xabi
getContractXabiDeprecated (ContractName contractName) contractId chainId = do
  metadataId <- case contractId of
    Named _ -> blocQuery1 "getContractXabi" $ getContractsMetaDataId contractName contractId chainId
    Unnamed contractAddr -> getContractsMetaDataIdExhaustive contractName contractAddr chainId
  funcs <- getXabiFunctionsQuery metadataId
  constr <- getXabiConstrQuery metadataId
  vars <- getXabiVariablesQuery metadataId
  typeDefs <- getXabiTypeDefs metadataId
  return xabiEmpty{ xabiFuncs = funcs
                  , xabiConstr = constr
                  , xabiVars = vars
                  , xabiTypes = typeDefs
                  }
