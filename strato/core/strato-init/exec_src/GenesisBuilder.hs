{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans      #-}

import BlockApps.Logging (runStdoutLoggingT)
import Blockchain.DB.CodeDB (addCode)
import Blockchain.Data.Block (blockBlockData)
import qualified Blockchain.Data.BlockHeader as BH
import Blockchain.Data.GenesisBlock (genesisInfoToGenesisBlock)
import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Builder
import Blockchain.Init.Monad (runSetupDBMInDir)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Validator
import Conduit (runResourceT)
import Control.Monad (void)
import qualified Data.Aeson as Ae
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import Data.Default
import Data.Foldable (foldlM)
import System.Console.GetOpt
import System.Environment

--------------------------------------------------------------------------------------------
----------------------------------------- ARGS ---------------------------------------------
--------------------------------------------------------------------------------------------

data Options = Options
  { optValidators :: [Validator],
    optAdmins :: [Address],
    optFaucets :: [Address],
    optInput :: GenesisInfo,
    optOutputName :: String
  }
  deriving (Show)

defaultOptions :: Options
defaultOptions =
  Options
    { optValidators = [],
      optAdmins = [],
      optFaucets = [],
      optInput = error "Uninitialized input genesis info",
      optOutputName = "outputGenesisBlock.json"
    }

options :: [OptDescr (Options -> IO Options)]
options =
  [ Option
      ['v']
      ["validators"]
      ( ReqArg
          ( \s opts -> do
              valsStr <- readFile s
              let eVals = Ae.eitherDecodeStrict (C8.pack valsStr) :: Either String [Validator]
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
              let eAdmins = Ae.eitherDecodeStrict (C8.pack adminsStr) :: Either String [Address]
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
          ( \_ opts -> return opts
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

  let gi' = buildGenesisInfo optFaucets optValidators optAdmins def

  -- Compute the correct stateRoot by populating the MPT in a temp directory
  -- (avoids locking conflicts with running strato processes)
  computedStateRoot <- runStdoutLoggingT $ runResourceT $ runSetupDBMInDir "/tmp/genesis-builder-db" $ do
    void $ addCode mempty
    genesisBlock <- genesisInfoToGenesisBlock gi'
    return $ BH.stateRoot $ blockBlockData genesisBlock

  let gi'' = gi' { Blockchain.Data.GenesisInfo.stateRoot = computedStateRoot }
  B.writeFile optOutputName . BL.toStrict $ Ae.encode gi''
  putStrLn $ "Done. Output genesis block info was written to " ++ optOutputName
  putStrLn $ "Computed stateRoot: " ++ show computedStateRoot
