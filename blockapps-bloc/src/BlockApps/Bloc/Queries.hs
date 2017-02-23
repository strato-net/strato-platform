{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Queries where

import Data.ByteString (ByteString)
import qualified Data.ByteString.Char8 as Char8
import Data.Functor.Contravariant
import Data.Int (Int32)
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text.Encoding as Text
import Data.Time (UTCTime)
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Hasql.Query

import BlockApps.Data
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Crypto

getAddressesQuery :: Query () [Address]
getAddressesQuery = statement
  "SELECT address from addresses;"
  Encoders.unit
  decoder
  False
  where
    decoder = Decoders.rowsList $ Decoders.value addressDecoder

getSearchContractQuery :: Query Text [Address]
getSearchContractQuery = statement
  "SELECT CI.address FROM contracts_instance CI\
  \ JOIN contracts_metadata CM ON CM.id = CI.contracts_metadata_id\
  \ JOIN contracts C ON C.id = CM.contract_id\
  \ WHERE C.name = $1 ORDER BY timestamp DESC;"
  (Encoders.value Encoders.text)
  (Decoders.rowsList (Decoders.value addressDecoder))
  False

getUsersQuery :: Query () [Text]
getUsersQuery = statement
  "SELECT name FROM users;"
  Encoders.unit
  (Decoders.rowsList (Decoders.value Decoders.text))
  False

getUsersUserQuery :: Query Text [Address]
getUsersUserQuery = statement
  "SELECT K.address FROM users U JOIN keystore K\
  \ ON K.user_id = U.id WHERE U.name = $1;"
  (Encoders.value Encoders.text)
  (Decoders.rowsList (Decoders.value addressDecoder))
  False

postUsersUserQuery :: Query (Text,KeyStore) ()
postUsersUserQuery = statement
  "WITH userid AS (\
  \ SELECT id FROM users WHERE name = $1)\
  \ , newUserId AS \
  \ (\
  \   INSERT INTO users (name) \
  \   SELECT $1 WHERE NOT EXISTS (SELECT id FROM users WHERE name = $1)\
  \   RETURNING id \
  \ )\
  \ INSERT INTO keystore (salt,password_hash,nonce,enc_sec_key,pub_key,address,user_id)\
  \ SELECT $2, $3, $4, $5, $6, $7, uid.id FROM \
  \(SELECT id FROM userid UNION SELECT id FROM newUserId) uid;"
  encoder
  Decoders.unit
  False
  where
    encoder = mconcat
      [ contramap fst (Encoders.value Encoders.text)
      , contramap snd keyStoreEncoder
      ]
    keyStoreEncoder = mconcat
      [ contramap keystoreSalt (Encoders.value Encoders.bytea)
      , contramap keystorePasswordHash (Encoders.value Encoders.bytea)
      , contramap keystoreAcctNonce (Encoders.value Encoders.bytea)
      , contramap keystoreAcctEncSecKey (Encoders.value Encoders.bytea)
      , contramap keystorePubKey (Encoders.value Encoders.bytea)
      , contramap keystoreAcctAddress (Encoders.value addressEncoder)
      ]

getContractsAddressesQuery :: Query () [(Text,Address,UTCTime)]
getContractsAddressesQuery = statement
  "SELECT \
  \   C.name \
  \ , CI.address \
  \ , CI.timestamp \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM \
  \  ON CM.contract_id = C.id \
  \JOIN contracts_instance CI \
  \  ON CI.contract_metadata_id = CM.id;"
  Encoders.unit
  decoder
  False
  where
    decoder = Decoders.rowsList $ (,,)
      <$> Decoders.value Decoders.text
      <*> Decoders.value addressDecoder
      <*> Decoders.value Decoders.timestamptz

getContractsNamesAsAddressesQuery :: Query () [(Text,Text,UTCTime)]
getContractsNamesAsAddressesQuery = statement
  "SELECT \
  \   C.name \
  \ , C2.name as address \
  \ , CI.timestamp \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM \
  \  ON CM.contract_id = C.id \
  \JOIN contracts_lookup CL \
  \  ON CL.contract_metadata_id = CM.id \
  \JOIN contracts_metadata CM2 \
  \  ON CM2.id = CL.linked_metadata_id \
  \JOIN contracts C2 \
  \  ON C2.id = CM2.contract_id \
  \JOIN contracts_instance CI \
  \  ON CI.contract_metadata_id = CM2.id;"
  Encoders.unit
  decoder
  False
  where
    decoder = Decoders.rowsList $ (,,)
      <$> Decoders.value Decoders.text
      <*> Decoders.value Decoders.text
      <*> Decoders.value Decoders.timestamptz

getContractsDataAddressesQuery :: Query Text [Address]
getContractsDataAddressesQuery = statement
  "SELECT \
  \  CI.address \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM ON \
  \  CM.contract_id = C.id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name=$1;"
  (Encoders.value Encoders.text)
  (Decoders.rowsList (Decoders.value addressDecoder))
  False

getContractsDataNamesQuery :: Query Text [Text]
getContractsDataNamesQuery = statement
  "SELECT \
  \  C.name \
  \FROM contracts C \
  \  WHERE C.name=$1 \
  \UNION \
  \SELECT \
  \  C2.Name \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM ON \
  \  CM.contract_id = C.id \
  \JOIN contracts_lookup CL ON \
  \  CL.contract_metadata_id = CM.id \
  \JOIN contracts_metadata CM2 ON \
  \  CM2.id = CL.linked_metadata_id \
  \JOIN contracts C2 ON \
  \  C2.id = CM2.contract_id \
  \WHERE C.name=$1 \
  \UNION \
  \SELECT \
  \  'Latest' \
  \FROM \
  \  contracts C WHERE C.name=$1;"
  (Encoders.value Encoders.text)
  (Decoders.rowsList (Decoders.value Decoders.text))
  False

getContractsMetaDataIdByAddressQuery
  :: Query (Text,Address) Int32
getContractsMetaDataIdByAddressQuery = statement
  "SELECT \
  \  CM.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name=$1 AND CI.address=$2;"
  encoder
  (Decoders.singleRow (Decoders.value Decoders.int4))
  False
  where
    encoder = mconcat
      [ contramap fst (Encoders.value Encoders.text)
      , contramap snd (Encoders.value addressEncoder)
      ]

getContractsContractByAddressQuery
  :: Query (Text,Address) (ContractDetails,Int32)
getContractsContractByAddressQuery = statement
  "SELECT \
  \   CM.bin \
  \ , CI.address \
  \ , CM.bin_runtime \
  \ , CM.code_hash \
  \ , C.name \
  \ , CM.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name=$1 AND CI.address=$2;"
  encoder
  decoder
  False
  where
    encoder = mconcat
      [ contramap fst (Encoders.value Encoders.text)
      , contramap snd (Encoders.value addressEncoder)
      ]
    decoder = Decoders.singleRow $ (,)
      <$> decoderContractDetails
      <*> Decoders.value Decoders.int4
    decoderContractDetails = ContractDetails
      <$> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> (Just . Unnamed <$> Decoders.value addressDecoder)
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> Decoders.value Decoders.text
      <*> pure (Xabi Nothing Nothing Nothing)

getContractsMetaDataIdByNameQuery
  :: Query (Text,Text) Int32
getContractsMetaDataIdByNameQuery = statement
  "SELECT \
  \ CM2.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_lookup CL ON \
  \  CL.contract_metadata_id = CM.id \
  \JOIN contracts_metadata CM2 ON \
  \  CM2.id = CL.linked_metadata_id \
  \JOIN contracts C2 ON \
  \  C2.id = CM2.contract_id \
  \WHERE C.name = $1 AND C2.name=$2 ORDER BY CM2.id DESC LIMIT 1;"
  encoder
  (Decoders.singleRow (Decoders.value Decoders.int4))
  False
  where
    encoder = mconcat
      [ contramap fst (Encoders.value Encoders.text)
      , contramap snd (Encoders.value Encoders.text)
      ]

getContractsContractByNameQuery
  :: Query (Text,Text) (ContractDetails,Int32)
getContractsContractByNameQuery = statement
  "SELECT \
  \   CM2.bin \
  \ , CM2.bin_runtime \
  \ , CM2.code_hash \
  \ , C2.name \
  \ , CM2.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_lookup CL ON \
  \  CL.contract_metadata_id = CM.id \
  \JOIN contracts_metadata CM2 ON \
  \  CM2.id = CL.linked_metadata_id \
  \JOIN contracts C2 ON \
  \  C2.id = CM2.contract_id \
  \WHERE C.name = $1 AND C2.name=$2 ORDER BY CM2.id DESC LIMIT 1;"
  encoder
  decoder
  False
  where
    encoder = mconcat
      [ contramap fst (Encoders.value Encoders.text)
      , contramap snd (Encoders.value Encoders.text)
      ]
    decoder = Decoders.singleRow $ (,)
      <$> decoderContractDetails
      <*> Decoders.value Decoders.int4
    decoderContractDetails = ContractDetails
      <$> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> pure Nothing
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> Decoders.value Decoders.text
      <*> pure (Xabi Nothing Nothing Nothing)

getContractMetaDataIdBySameNameQuery
  :: Query Text Int32
getContractMetaDataIdBySameNameQuery = statement
  "SELECT \
  \ CM.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \WHERE C.name = $1 ORDER BY CM.id DESC LIMIT 1"
  (Encoders.value Encoders.text)
  (Decoders.singleRow (Decoders.value Decoders.int4))
  False

getContractsContractBySameNameQuery
  :: Query Text (ContractDetails,Int32)
getContractsContractBySameNameQuery = statement
  "SELECT \
  \   CM.bin \
  \ , CM.bin_runtime \
  \ , CM.code_hash \
  \ , C.name \
  \ , CM.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \WHERE C.name = $1 ORDER BY CM.id DESC LIMIT 1"
  (Encoders.value Encoders.text)
  decoder
  False
  where
    decoder = Decoders.singleRow $ (,)
      <$> decoderContractDetails
      <*> Decoders.value Decoders.int4
    decoderContractDetails = ContractDetails
      <$> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> pure Nothing
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> Decoders.value Decoders.text
      <*> pure (Xabi Nothing Nothing Nothing)

getContractMetaDataIdByLatestQuery
  :: Query Text Int32
getContractMetaDataIdByLatestQuery = statement
  "SELECT \
  \ CM.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name = $1 ORDER BY CI.timestamp DESC LIMIT 1;"
  (Encoders.value Encoders.text)
  (Decoders.singleRow (Decoders.value Decoders.int4))
  False

getContractsContractLatestQuery
  :: Query Text (ContractDetails,Int32)
getContractsContractLatestQuery = statement
  "SELECT \
  \   CM.bin \
  \ , CM.bin_runtime \
  \ , CM.code_hash \
  \ , C2.name \
  \ , CM.id \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name = $1 ORDER BY CI.timestamp DESC LIMIT 1;"
  (Encoders.value Encoders.text)
  decoder
  False
  where
    decoder = Decoders.singleRow $ (,)
      <$> decoderContractDetails
      <*> Decoders.value Decoders.int4
    decoderContractDetails = ContractDetails
      <$> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> pure Nothing
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> (Text.decodeUtf8 <$> Decoders.value Decoders.bytea)
      <*> Decoders.value Decoders.text
      <*> pure (Xabi Nothing Nothing Nothing)

getXabiFunctionsQuery :: Query Int32 [(Int32,Text,ByteString)]
getXabiFunctionsQuery = statement
  "SELECT \
  \  XF.id \
  \ ,XF.name \
  \ ,XF.selector \
  \FROM \
  \ xabi_functions XF \
  \WHERE \
  \  XF.is_constructor = false \
  \  AND XF.contract_metadata_id = $1;"
  (Encoders.value Encoders.int4)
  decoder
  False
  where
    decoder = Decoders.rowsList $ (,,)
      <$> Decoders.value Decoders.int4
      <*> Decoders.value Decoders.text
      <*> Decoders.value Decoders.bytea

getXabiConstrQuery :: Query Int32 Int32
getXabiConstrQuery = statement
  "SELECT \
  \  XF.id \
  \FROM \
  \ xabi_functions XF \
  \WHERE \
  \  XF.is_constructor = true \
  \  AND XF.contract_metadata_id = $1;"
  (Encoders.value Encoders.int4)
  (Decoders.singleRow (Decoders.value Decoders.int4))
  False

getXabiFunctionsArgsQuery :: Query Int32 [Arg]
getXabiFunctionsArgsQuery = statement
  "SELECT \
  \  ,XFA.name \
  \  ,XFA.index \
  \  ,XT.type \
  \  ,XT.typedef \
  \  ,XT.is_dynamic \
  \  ,XT.bytes \
  \  ,XTE.type as entry_type \
  \  ,XTE.bytes as entry_bytes \
  \FROM \
  \  xabi_function_arguments XFA \
  \JOIN \
  \  xabi_types XT ON XT.id = XFA.type_id \
  \LEFT OUTER JOIN \
  \  xabi_types XTE ON XTE.id = XT.entry_type_id \
  \WHERE \
  \  XFA.function_id = $1;"
  (Encoders.value Encoders.int4)
  decoder
  False
  where
    decoder = Decoders.rowsList $ Arg
      <$> Decoders.nullableValue Decoders.text
      <*> Decoders.value Decoders.int4
      <*> Decoders.nullableValue Decoders.text
      <*> Decoders.nullableValue Decoders.text
      <*> Decoders.nullableValue Decoders.bool
      <*> Decoders.nullableValue Decoders.int4
      <*> entryDecoder

getXabiFunctionsReturnValuesQuery :: Query Int32 [(Text,Val)]
getXabiFunctionsReturnValuesQuery = statement
  "SELECT \
  \  (CASE WHEN XFR.name IS NULL THEN '#' + CAST(XFR.index AS VARCHAR(20)) ELSE XFR.name END) as name\
  \  ,XFR.index \
  \  ,XT.type \
  \  ,XT.typedef \
  \  ,XT.is_dynamic \
  \  ,XT.bytes \
  \  ,XTE.type as entry_type \
  \  ,XTE.bytes as entry_bytes \
  \FROM \
  \  xabi_function_return XFR \
  \JOIN \
  \  xabi_types XT ON XT.id = XFR.type_id \
  \LEFT OUTER JOIN \
  \  xabi_types XTE ON XTE.id = XT.entry_type_id \
  \WHERE \
  \  XFR.function_id = $1;"
  (Encoders.value Encoders.int4)
  decoder
  False
  where
    decoder = Decoders.rowsList $ (,)
      <$> Decoders.value Decoders.text
      <*> valDecoder
    valDecoder = Val
      <$> Decoders.value Decoders.int4
      <*> Decoders.nullableValue Decoders.text
      <*> Decoders.nullableValue Decoders.text
      <*> Decoders.nullableValue Decoders.bool
      <*> Decoders.nullableValue Decoders.int4
      <*> entryDecoder

getXabiVariablesQuery :: Query Int32 [(Text,Var)]
getXabiVariablesQuery = statement
  "SELECT \
  \   XV.name \
  \  ,XV.at_bytes \
  \  ,XT.type \
  \  ,XT.typedef \
  \  ,XT.is_dynamic \
  \  ,XT.is_signed \
  \  ,XT.bytes \
  \  ,XTE.type as entry_type \
  \  ,XTE.bytes as entry_bytes \
  \  ,XTV.type as value_type \
  \  ,XTV.bytes as values_bytes \
  \  ,XTV.is_dynamic as value_is_dynamic \
  \  ,XTV.is_signed as value_is_signed \
  \  ,XTVE.type as value_entry_type \
  \  ,XTVE.bytes as value_entry_bytes \
  \  ,XTK.type as key_type \
  \  ,XTK.bytes as key_bytes \
  \  ,XTK.is_dynamic as key_is_dynamic \
  \  ,XTK.is_signed as key_is_signed \
  \  ,XTVK.type as key_entry_type \
  \  ,XTVK.bytes as key_entry_bytes \
  \FROM \
  \  xabi_variables XV \
  \LEFT OUTER JOIN \
  \  xabi_types XT ON XT.id = XV.type_id \
  \LEFT OUTER JOIN \
  \  xabi_types XTE ON XTE.id = XT.entry_type_id \
  \LEFT OUTER JOIN \
  \  xabi_types XTV ON XTV.id = XT.value_type_id \
  \LEFT OUTER JOIN \
  \  xabi_types XTK ON XTK.id = XT.key_type_id \
  \LEFT OUTER JOIN \
  \  xabi_types XTVE ON XTVE.id = XT.entry_type_id \
  \LEFT OUTER JOIN \
  \  xabi_types XTKE ON XTKE.id = XT.entry_type_id \
  \WHERE XV.contract_metadata_id = $1;"
  (Encoders.value Encoders.int4)
  decoder
  False
  where
    decoder = Decoders.rowsList $ (,)
      <$> Decoders.value Decoders.text
      <*> varDecoder
    varDecoder = Var
      <$> Decoders.value Decoders.int4
      <*> Decoders.nullableValue Decoders.text
      <*> Decoders.nullableValue Decoders.text
      <*> Decoders.nullableValue Decoders.bool
      <*> Decoders.nullableValue Decoders.bool
      <*> Decoders.nullableValue Decoders.int4
      <*> entryDecoder
      <*> simpleVarDecoder
      <*> simpleVarDecoder
    simpleVarDecoder = do
      tyMaybe <- Decoders.nullableValue Decoders.text
      byMaybe <- Decoders.nullableValue Decoders.int4
      dyMaybe <- Decoders.nullableValue Decoders.bool
      siMaybe <- Decoders.nullableValue Decoders.bool
      enMaybe <- entryDecoder
      case tyMaybe of
        Nothing -> return Nothing
        Just ty -> return . Just $
          SimpleVar ty byMaybe dyMaybe siMaybe enMaybe


createContractQuery :: Query Text Int32
createContractQuery = statement
  "WITH contract_id AS (\
  \ SELECT id FROM contracts WHERE name = $1)\
  \ , new_contract_id AS \
  \ (\
  \   INSERT INTO contracts (name) \
  \   SELECT $1 WHERE NOT EXISTS (SELECT id FROM contracts WHERE name = $1)\
  \   RETURNING id \
  \ )\
  \SELECT id FROM contract_id UNION SELECT id FROM new_contract_id;"
  (Encoders.value Encoders.text)
  (Decoders.singleRow (Decoders.value Decoders.int4))
  False

upsertContractMetaDataQuery
  :: Query (Int32,ContractDetails,ByteString) (Text,ByteString)
upsertContractMetaDataQuery = statement
  "WITH upsert AS (UPDATE contracts_metadata SET \
  \  bin = $2\
  \ ,bin_runtime = $3\
  \ ,code_hash = $4\
  \ ,bin_runtime_hash = $5 \
  \WHERE contract_id = $1 \
  \  AND NOT EXISTS ( \
  \      SELECT CI.id \
  \      FROM contracts_instance CI \
  \      WHERE contract_metadata_id = id\
  \      ) \
  \) \
  \INSERT INTO contracts_metadata (contract_id, bin, bin_runtime, code_hash, bin_runtime_hash) \
  \SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT * FROM upsert);"
  encoder
  decoder
  False
  where
    encoder = mconcat
      [ contramap (\ (x,_,_) -> x) (Encoders.value Encoders.int4)
      , contramap (\ (_,y,_) -> y) encoderContractDetails
      , contramap (\ (_,_,z) -> z) (Encoders.value Encoders.bytea)
      ]
    encoderContractDetails = mconcat
      [ contramap (Text.encodeUtf8 . contractdetailsBin) (Encoders.value Encoders.bytea)
      , contramap (Text.encodeUtf8 . contractdetailsBinRuntime) (Encoders.value Encoders.bytea)
      , contramap (Text.encodeUtf8 . contractdetailsCodeHash) (Encoders.value Encoders.bytea)
      ]
    decoder = Decoders.singleRow $ (,)
      <$> Decoders.value Decoders.text
      <*> Decoders.value Decoders.bytea

addressDecoder :: Decoders.Value Address
addressDecoder
  = fromMaybe (error "cannot decode address")
  . stringAddress
  . Char8.unpack <$> Decoders.bytea

addressEncoder :: Encoders.Value Address
addressEncoder = contramap (Char8.pack . addressString) Encoders.bytea

entryDecoder :: Decoders.Row (Maybe Entry)
entryDecoder = do
  ty <- Decoders.value Decoders.text
  by <- Decoders.nullableValue Decoders.int4
  return $ Entry <$> by <*> Just ty
