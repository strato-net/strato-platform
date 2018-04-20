{-# LANGUAGE TemplateHaskell #-}

import HFlags
import System.Environment (getProgName)
import System.Exit        (die)
import System.IO (readFile, withFile, IOMode(..))

import Control.Monad (when)
import Data.Aeson (encode)
import Data.Aeson.Extra (eitherDecodeStrict)
import Data.ByteString (hGetContents, ByteString)
import qualified Data.ByteString.Lazy as L
import Data.List (intercalate)

import Blockchain.Generation (insertContractsCount, insertContractsJSON)
import Blockchain.Strato.Model.Address ()

defineFlag "g:genesis_file" ("" :: String) "Filename containing pre-modifications genesis block"
defineFlag "s:start" (0xfeb1989bbbea7000000000000000000000000000 :: Integer) "Starting address for seeding contract"
defineFlag "b:bytecode_file" ("" :: String) "Filename pointing to the contract bytecode"
defineFlag "source_file" ("" :: String) "Filename pointing to the contract source"
defineFlag "contract_name" ("" :: String) "Name of the contract being uploaded"
defineFlag "n:number" (0 :: Int) "Number of copies to seed"
defineFlag "o:output_file" ("genesisWithContracts.json" :: String) "Name of output file to write"
defineFlag "r:records_file" ("" :: String) "Filename containing CSV records of data to insert.\
                                           \Only ints and strings are accepted (for now only \
                                           \ small strings as well). Little validation is \
                                           \ performed. Rows with fewer columns will \
                                           \ have fewer columns inserted."

defineFlag "f:fake_flag" (0:: Integer) "Hflags will ignore this flag."


usage :: IO ()
usage = do
  name <- getProgName
  die . intercalate " " $ ["usage:", name, "--genesis_file=<gen.json>",
                           "--bytecode_file=<ctract.bin-runtime>",
                           "--source_file=<ctract.sol>",
                           "--contract_name=<Ctract>",
                           "[--number=<200>",
                           "--start=<0xdeadbeef>",
                           "--output_file=<out.json>]"]

readBS :: FilePath -> IO ByteString
readBS path = do
  when (null path) usage
  withFile path ReadMode hGetContents

readS :: FilePath -> IO String
readS path = do
  when (null path) usage
  readFile path

main :: IO ()
main = do
  _ <- $initHFlags "Setup Genesis Generation flags"
  bytes <- readBS flags_bytecode_file
  genesisText <- readBS flags_genesis_file
  let name = flags_contract_name
  when (null name) usage
  src <- readS flags_source_file
  let genesis = case eitherDecodeStrict genesisText of
                    Right g -> g
                    Left err -> error ("couldn't parse genesis: " ++ err)

  insert <- if null flags_records_file
              then return $ insertContractsCount flags_number
              else do
                  json <- L.readFile flags_records_file
                  return $ insertContractsJSON json
  let output = insert name src bytes (fromInteger flags_start) genesis

  case output of
    Left err -> error $ "couldn't generate: " ++ err
    Right o -> do
      let outputText = encode o
      withFile flags_output_file WriteMode (flip L.hPut $ outputText)
