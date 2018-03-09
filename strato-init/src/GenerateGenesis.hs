{-# LANGUAGE TemplateHaskell #-}

import HFlags
import System.Environment (getProgName)
import System.Exit        (die)
import System.IO (withFile, IOMode(..))

import Control.Monad (when)
import Data.Aeson (eitherDecodeStrict)
import Data.Aeson.Extra (encodeStrict)
import Data.ByteString (hGetContents, hPut, ByteString)
import Data.List (intercalate)

import Blockchain.Generation (insertContracts)
import Blockchain.Strato.Model.Address (Address(..))

defineFlag "g:genesis_file" ("" :: String) "Filename containing pre-modifications genesis block"
defineFlag "b:bytecode_file" ("" :: String) "Filename pointing to the contract definition"
defineFlag "n:number" (0 :: Integer) "Number of copies to seed"
defineFlag "o:output_file" ("genesisWithContracts.json" :: String) "Name of output file to write"
defineEQFlag "s:start" [| Address 0xfeb1989bbbea7000000000000000000000000000 :: Address |]
    "ADDRESS" "Starting address for seeded contract"


usage :: IO ()
usage = do
  name <- getProgName
  die . intercalate " " $ ["usage:", name, "--genesis_file=<gen.json>",
                           "--bytecode_file=<ctract.bin-runtime>",
                           "[--number=<200>",
                           "--start=<0xdeadbeef>",
                           "--output_file=<out.json>]"]

readBS :: FilePath -> IO ByteString
readBS path = do
  when (null path) usage
  withFile path ReadMode hGetContents

main :: IO ()
main = do
  _ <- $initHFlags "Setup Genesis Generation flags"
  bytes <- readBS flags_bytecode_file
  genesisText <- readBS flags_genesis_file
  let genesis = case eitherDecodeStrict genesisText of
                    Right g -> g
                    Left err -> error ("couldn't parse genesis: " ++ err)

  let output = insertContracts bytes flags_start flags_number genesis

  let outputText = encodeStrict output
  withFile flags_output_file WriteMode (flip hPut $ outputText)
