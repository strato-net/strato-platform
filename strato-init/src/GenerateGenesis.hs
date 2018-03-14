{-# LANGUAGE TemplateHaskell #-}

import HFlags
import System.Environment (getProgName)
import System.Exit        (die)
import System.IO (withFile, IOMode(..))

import Control.Monad (when)
import Data.Aeson (encode)
import Data.Aeson.Extra (eitherDecodeStrict)
import Data.ByteString (hGetContents, ByteString)
import Data.ByteString.Lazy (hPut)
import Data.List (intercalate)

import Blockchain.Generation (insertContracts)
import Blockchain.Strato.Model.Address ()

defineFlag "g:genesis_file" ("" :: String) "Filename containing pre-modifications genesis block"
defineFlag "s:start" (0xfeb1989bbbea7000000000000000000000000000 :: Integer) "Starting address for seeding contract"
defineFlag "b:bytecode_file" ("" :: String) "Filename pointing to the contract definition"
defineFlag "n:number" (0 :: Integer) "Number of copies to seed"
defineFlag "o:output_file" ("genesisWithContracts.json" :: String) "Name of output file to write"
defineFlag "f:fake_flag" (0:: Integer) "Hflags will ignore this flag."


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

  let output = insertContracts bytes (fromInteger flags_start) flags_number genesis

  let outputText = encode output
  withFile flags_output_file WriteMode (flip hPut $ outputText)
