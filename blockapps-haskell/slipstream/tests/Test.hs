{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Main where

import Test.Hspec
import Slipstream.OutputData
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import qualified Data.ByteString.Char8 as BC
import Conduit
import Data.Default
import Data.IORef
import qualified Data.Map as M
import qualified BlockApps.Solidity.Value as V

import Slipstream.Events

{-
Test: Message conversion to statediff is successful and accurate
Test: Failure to receive kafka message generates correct retry message and correct logging
Test: Failed message conversion generates correct error message
Test: db writes are successful (test our common pre-established format)
Test: when db queries fail, error message is correct and is logged correctly
Create some formal tests to confirm correct db writes in each of the tables
Test: when db writes fail, error message is correct and is logged correctly
Test: indexes are accurate
-}

dbSelect :: String -> IO(String)
dbSelect insrt = do
  conn <- pgConnect dbConnect
  let qry = rawPGSimpleQuery $ BC.pack insrt
  p <- pgRunQuery conn qry
  pgDisconnect conn
  --p <- ins
  return $ show $ snd p

main :: IO ()
main = hspec $ do

  describe "Array serialization" $ do
    it "should create JSON entries" $ do
      let input = [ProcessedContract {
             address = "<ADDRESS>",
             codehash = "<CODEHASH>",
             abi = "<ABI>",
             contractName = "<CONTRACT>",
             chain = "<CHAIN>",
             contractData = M.singleton "owners" $ V.ValueArrayDynamic [
                V.ValueStruct [
                  ("number", V.SimpleValue $ V.ValueInt False Nothing 18199984780605),
                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")]]
            }]

      g <- newIORef def
      runConduit (yield input .| createInserts g .| sinkList)
        `shouldReturn` [
          "insert into contract (\"codeHash\", contract, abi, \"chainId\") values ('<CODEHASH>', '<CONTRACT>', '<ABI>', '<CHAIN>') ON CONFLICT DO NOTHING;",
          "create table if not exists \"<CONTRACT>\" (address text, \"chainId\" text, \"owners\" json, CONSTRAINT \"<CONTRACT>_pkey\" PRIMARY KEY (address, \"chainId\") );",
          "insert into \"<CONTRACT>\" (address, \"chainId\", \"owners\") values ('<ADDRESS>', '<CHAIN>', '[{\"hash\":\"Owner_hash_181999847806006\",\"number\":\"18199984780605\"}]') on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\", \"owners\" = excluded.\"owners\";"]
