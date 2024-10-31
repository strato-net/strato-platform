{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Data.ChainInfo
import Blockchain.Data.GenesisInfo
import Blockchain.Generation (insertContractsCount, insertContractsJSON, insertContractsJSONHashMaps)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256
import Control.Monad (when)
import Data.Aeson (eitherDecodeStrict, encode)
import Data.ByteString (ByteString, hGetContents)
import qualified Data.ByteString.Lazy as L
import Data.List (intercalate)
import qualified Data.Text as T
import HFlags
import Numeric
import System.Environment (getProgName)
import System.Exit (die)
import System.IO (IOMode (..), withFile)

defineFlag "g:genesis_file" ("" :: String) "Filename containing pre-modifications genesis block"
defineFlag "s:start" (0xfeb1989bbbea7000000000000000000000000000 :: Integer) "Starting address for seeding contract"
defineFlag "b:bytecode_file" ("" :: String) "Filename pointing to the contract bytecode"
defineFlag "source_file" ("" :: String) "Filename pointing to the contract source"
defineFlag "contract_name" ("" :: String) "Name of the contract being uploaded"
defineFlag "n:number" (0 :: Int) "Number of copies to seed"
defineFlag "o:output_file" ("genesisWithContracts.json" :: String) "Name of output file to write"
defineFlag "o:output_account_info_file" ("accountInfo" :: String) "Name of output account info file to write"
defineFlag
  "r:records_file"
  ("" :: String)
  "Filename containing CSV records of data to insert.\
  \Only ints and strings are accepted (for now only \
  \ small strings as well). Little validation is \
  \ performed. Rows with fewer columns will \
  \ have fewer columns inserted."
defineFlag
  "t:hash_maps"
  (False :: Bool)
  "Use an alternative JSON parsing scheme, where objects\
  \ are hashmaps instead of structs"
defineFlag "f:fake_flag" (0 :: Integer) "Hflags will ignore this flag."

usage :: IO ()
usage = do
  name <- getProgName
  die . intercalate " " $
    [ "usage:",
      name,
      "--genesis_file=<gen.json>",
      "--bytecode_file=<ctract.bin-runtime>",
      "--source_file=<ctract.sol>",
      "--contract_name=<Ctract>",
      "[--number=<200>",
      "--start=<0xdeadbeef>",
      "--output_file=<out.json>]"
    ]

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

  insert <-
    if null flags_records_file
      then return $ insertContractsCount flags_number
      else do
        json <- L.readFile flags_records_file
        return $
          if flags_hash_maps
            then insertContractsJSONHashMaps json
            else insertContractsJSON json
  let output = insert (T.pack name) (T.pack src) bytes (fromInteger flags_start) genesis
  let outputText = encode output {genesisInfoAccountInfo = []}
  withFile flags_output_file WriteMode (flip L.hPut $ outputText)
  writeFile flags_output_account_info_file $ unlines $ map showAccountInfo $ genesisInfoAccountInfo output

showAccountInfo :: AccountInfo -> String
showAccountInfo (NonContract (Address address) balance) =
  "a " ++ showHex address "" ++ " " ++ show balance
showAccountInfo (ContractNoStorage (Address address) balance code) =
  "a " ++ showHex address "" ++ " " ++ show balance ++ show code
showAccountInfo (ContractWithStorage (Address address) balance code storage) =
  "a " ++ addressString ++ " " ++ show balance ++ " " ++ showCodeHash code "" ++ "\n"
    ++ unlines (map (\(k, v) -> "s " ++ addressString ++ " " ++ showHex k "" ++ " " ++ showHex v "") storage)
  where
    addressString = showHex address ""
    showCodeHash (ExternallyOwned c) = showHex $ keccak256ToWord256 c
    showCodeHash (SolidVMCode _ c) = showHex $ keccak256ToWord256 c
    showCodeHash (CodeAtAccount acct name) = const $ name ++ "@" ++ show acct
showAccountInfo (SolidVMContractWithStorage (Address address) balance code storage) =
  "a " ++ addressString ++ " " ++ show balance ++ " " ++ showCodeHash code "" ++ "\n"
    ++ unlines (map (\(k, v) -> "s " ++ addressString ++ " " ++ show k ++ " " ++ show v) storage)
  where
    addressString = showHex address ""
    showCodeHash (ExternallyOwned c) = showHex $ keccak256ToWord256 c
    showCodeHash (SolidVMCode _ c) = showHex $ keccak256ToWord256 c
    showCodeHash (CodeAtAccount acct name) = const $ name ++ "@" ++ show acct
