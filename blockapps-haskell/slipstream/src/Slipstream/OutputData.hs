{-# LANGUAGE
  OverloadedStrings
  , TemplateHaskell
  , BangPatterns
#-}

module Slipstream.OutputData (
  convertRet,
  dbConnect,
  dbInsert
  ) where

import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString as B
import qualified Data.Text as T
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import Network
import Slipstream.Options
import Slipstream.SolidityValue
import qualified Data.Map as Map
import BlockApps.Solidity.Value
import Data.List
import Data.List.Utils (replace)
import Slipstream.Events
import Control.Monad
import qualified Data.List as L
import Data.IORef

--defaultMaxB :: Integer
--defaultMaxB = 32 * 1024 * 1024

valueToTxt :: SolidityValue -> String
valueToTxt (SolidityNum _) = "bigint"
valueToTxt (SolidityBool _) = "bool"
valueToTxt (SolidityArray _) = "text []"
valueToTxt (_) = "text"


tableColumn :: (T.Text, SolidityValue) -> String
tableColumn (x, y) = quoteIt (T.unpack x) ++ " " ++ valueToTxt y

quoteIt :: String -> String
quoteIt x = "\"" ++ x ++ "\"" -- need some type of escaping here also

singleQuoteIt :: String -> String
singleQuoteIt x = "'" ++ escapeQuotes x ++ "'"

valueToString :: SolidityValue -> String
valueToString (SolidityValueAsString x) = singleQuoteIt $ T.unpack x
valueToString (SolidityBool x) = singleQuoteIt $ show x
valueToString (SolidityNum x ) = singleQuoteIt $ show x
valueToString (SolidityBytes x) = singleQuoteIt $ show x
valueToString (SolidityArray x) =
  singleQuoteIt $  "{" ++ intercalate ", " (map arrayContent x) ++ "}"
valueToString (SolidityObject x) = singleQuoteIt $ show x

escapeQuotes :: String -> String
escapeQuotes x = replace "\'" "\'\'" $ replace "\"" "\\\"" x

arrayContent :: SolidityValue -> String
arrayContent (SolidityValueAsString x) = escapeQuotes $ T.unpack x
arrayContent (SolidityBool x) = show x
arrayContent (SolidityNum x ) = show x
arrayContent (SolidityBytes x) = escapeQuotes $ show x
arrayContent (SolidityArray x) = escapeQuotes $ show x
arrayContent (SolidityObject x) = escapeQuotes $ show x



--tableUpsert :: [(T.Text, SolidityValue)] -> String
--tableUpsert x = intercalate ", " $ map (upsertCriteria . fst) x

upsertCriteria :: T.Text -> String
upsertCriteria x = "\"" ++ T.unpack x ++ "\"" ++ " = excluded." ++ "\"" ++ T.unpack x ++ "\""

dbConnect :: PGDatabase
dbConnect =  PGDatabase
  { pgDBHost = flags_pghost :: HostName
  , pgDBPort = PortNumber $ read flags_pgport
  , pgDBUser = BC.pack flags_pguser :: B.ByteString
  , pgDBPass = BC.pack flags_password :: B.ByteString
  , pgDBName = BC.pack flags_database :: B.ByteString
  , pgDBDebug = False
  , pgDBLogMessage = print . PGError
  , pgDBParams = [("Timezone", "UTC")]
  }

dbInsert :: String -> PGConnection -> IO()
dbInsert insrt conn = do
  let qry = rawPGSimpleQuery $! BC.pack insrt
  _ <- pgQuery conn qry
  return ()

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

convertRet :: [ProcessedContract] -> PGConnection -> IORef (Map.Map String ContractAndXabi) -> IO()
convertRet metadata conn cache = do
  let firstContract = head metadata
  let hashVal = codehash firstContract
  contractCache <- readIORef cache
  cachedContract <- case Map.lookup hashVal contractCache of
    Just x -> return x
    Nothing -> return ContractAndXabi{contract = Left "error", xabi = "error", name = "error", contractStored = False}

  if (length metadata > 1)
    then do
      when (not $ contractStored cachedContract) $ do
          let conVals = "('" ++ (codehash $ head metadata) ++ "', '" ++ (contractName $ head metadata) ++ "', '" ++ (abi $ head metadata) ++ "', '" ++ (chain $ head metadata) ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True}
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn

      let fstContract = contractData $ head metadata
      let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ fstContract
      
      let createSt =
           "create table if not exists \"" ++ (contractName $ head metadata)
           ++ "\" ("
           ++ intercalate ", "
                   (
                     ["address text", "\"chainId\" text"]
                     ++ map tableColumn list
                     ++ ["CONSTRAINT \""
                         ++ contractName (head metadata)
                         ++ "_pkey\" PRIMARY KEY (address, \"chainId\")"]
                   )
           ++ " );"
      dbInsert createSt conn

      let keySt =
            "("
            ++ intercalate ", " ("address":"\"chainId\"":map (quoteIt . T.unpack . fst) list)
            ++ ")"

      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt =
                  "("
                  ++ intercalate ", " (
                             [singleQuoteIt (address row), singleQuoteIt (chain row)]
                             ++ map (valueToString . snd) rowList
                            )
                  ++ ")"
            return rowSt

      let inserts = L.intercalate ", " vals

          upsertList =
              ["address = excluded.address", "\"chainId\" = excluded.\"chainId\""]
              ++ map (upsertCriteria . fst) list


      let ins = "insert into \"" ++ (contractName $ head metadata) ++ "\" " ++ keySt ++ " values " ++ inserts ++ " on conflict (address, \"chainId\") do update set " ++ intercalate ", " upsertList ++ ";"

      dbInsert ins conn
  else do
    let row = head metadata

    if(contractStored cachedContract)
      then return ()
    else do
          let conVals = "('" ++ codehash row ++ "', '" ++ contractName row ++ "', '" ++ abi row ++ "', '" ++ chain row ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True}
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn
    let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row

    let createSt =
         "create table if not exists \"" ++ (contractName $ head metadata)
         ++ "\" ("
         ++ intercalate ", "
                (
                  ["address text", "\"chainId\" text"]
                  ++ map tableColumn list
                  ++ ["CONSTRAINT \""
                      ++ contractName (head metadata)
                      ++"_pkey\" PRIMARY KEY (address, \"chainId\")"]
                )
         ++ " );"

    dbInsert createSt conn

    let keySt =
            "("
            ++ intercalate ", " ("address":"\"chainId\"":map (quoteIt . T.unpack . fst) list)
            ++ ")"

    let vals =
         "("
         ++ intercalate ", " (
                 [singleQuoteIt (address row), singleQuoteIt (chain row)]
                 ++ map (valueToString . snd) list
               )
         ++ ")"

        upsertList =
           ["address = excluded.address", "\"chainId\" = excluded.\"chainId\""]
           ++ map (upsertCriteria . fst) list

    let ins = "insert into \"" ++ contractName row ++ "\" " ++ keySt ++ " values " ++ vals ++ " on conflict (address, \"chainId\") do update set " ++ intercalate ", " upsertList ++ ";"
    dbInsert ins conn
  return ()
