{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans      #-}

import BlockApps.X509
import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlock
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import qualified Data.Aeson as Ae
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import Data.Foldable (foldlM)
import System.Console.GetOpt
import System.Environment

--------------------------------------------------------------------------------------------
----------------------------------------- ARGS ---------------------------------------------
--------------------------------------------------------------------------------------------

data Options = Options
  { optCerts :: [X509Certificate],
    optValidators :: [ChainMemberParsedSet],
    optAdmins :: [ChainMemberParsedSet],
    optFaucets :: [Address],
    optInput :: GenesisInfo,
    optOutputName :: String
  }
  deriving (Show)

defaultOptions :: Options
defaultOptions =
  Options
    { optCerts = [],
      optValidators = [],
      optAdmins = [],
      optFaucets = [],
      optInput = error "Uninitialized input genesis info",
      optOutputName = "outputGenesisBlock.json"
    }

options :: [OptDescr (Options -> IO Options)]
options =
  [ Option
      ['c']
      ["certs"]
      ( ReqArg
          ( \s opts -> do
              certsStr <- readFile s
              let eCerts = Ae.eitherDecodeStrict (C8.pack certsStr) :: Either String [X509Certificate]
                  !certs = either error id eCerts
              return opts {optCerts = certs}
          )
          "Certs"
      )
      "The .json filepath of the X509 certificate information. Must be a valid array of JSON object with \
      \ commonName, country, organization, organizationUnit, and pubKey fields",
    Option
      ['v']
      ["validators"]
      ( ReqArg
          ( \s opts -> do
              valsStr <- readFile s
              let eVals = Ae.eitherDecodeStrict (C8.pack valsStr) :: Either String [ChainMemberParsedSet]
                  !vals = either error id eVals
              return opts {optValidators = vals}
          )
          "Validators"
      )
      "The .json filepath containing validator information. Must be a valid array of JSON object with \
      \ commonName, org, and orgUnit fields",
    Option
      ['a']
      ["admins"]
      ( ReqArg
          ( \s opts -> do
              adminsStr <- readFile s
              let eAdmins = Ae.eitherDecodeStrict (C8.pack adminsStr) :: Either String [ChainMemberParsedSet]
                  !admins = either error id eAdmins
              return opts {optAdmins = admins}
          )
          "Admins"
      )
      "The .json filepath containing admin information. Must be a valid array of JSON object with \
      \ commonName, org, and orgUnit fields",
    Option
      ['f']
      ["faucets"]
      ( ReqArg
          ( \s opts -> do
              faucetsStr <- readFile s
              let eFaucets = Ae.eitherDecodeStrict (C8.pack faucetsStr) :: Either String [Address]
                  !faucets = either error id eFaucets
              return opts {optFaucets = faucets}
          )
          "Faucets"
      )
      "The .json filepath containing faucet account information. Must be a valid array of JSON strings containing \
      \ 40 ASCII hex characters",
    Option
      ['i']
      ["input"]
      ( ReqArg
          ( \s opts -> do
              inputStr <- readFile s
              let eInput = Ae.eitherDecodeStrict (C8.pack inputStr) :: Either String GenesisInfo
                  !input = either error id eInput
              return opts {optInput = input}
          )
          "Input Genesis Info"
      )
      "The .json filepath containing input genesis block information. Must be a valid JSON object",
    Option
      ['o']
      ["output"]
      ( OptArg
          ( \mOut opts -> case mOut of
              Nothing -> return opts
              Just fileName -> return opts {optOutputName = fileName}
          )
          "OutputName"
      )
      "The .json filepath to write the created genesis block info to. If not provided, this will be written to ./outputGenesisBlock.json"
  ]

helpMessage :: String
helpMessage = usageInfo header options
  where
    header = "Usage: " ++ "genesis-builder" ++ " [OPTION...]"

parseArgs :: IO Options
parseArgs = do
  argv <- getArgs
  case getOpt RequireOrder options argv of
    ([], _, errs) -> ioError (userError (concat errs ++ helpMessage))
    (opts, _, _) -> foldlM (flip id) defaultOptions opts

main :: IO ()
main = do
  Options {..} <- parseArgs

  --------------------------------------------------------------------------------------------
  --------------------------------- GENERATE GENESIS INFO ------------------------------------
  --------------------------------------------------------------------------------------------

  let gi' = buildGenesisInfo optFaucets optCerts optValidators optAdmins optInput
  B.writeFile optOutputName . BL.toStrict $ Ae.encode gi'
  putStrLn $ "Done. Output genesis block info was written to " ++ optOutputName
