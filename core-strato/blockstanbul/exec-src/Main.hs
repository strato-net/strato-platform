{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
module Main where

import qualified Data.ByteString.Char8      as C8
import           Data.ByteString.Base16              as B16
import           Data.Foldable (foldlM)
import           Data.Maybe
import qualified Network.Haskoin.Crypto     as HK
import           System.Console.GetOpt
import           System.Environment

import           Blockchain.Blockstanbul.Authentication
import qualified Blockchain.Blockstanbul.HTTPAdmin as API
import           Blockchain.Strato.Model.Address
import           Blockchain.Data.RLP

data Options = Options
  { optRemove    :: Bool
  , optRecipient :: Address
  , optNode      :: String
  , optNonce     :: Int
  } deriving Show

defaultOptions :: Options
defaultOptions  = Options
  { optRemove    = False
  , optRecipient = 0x0000000000000000
  , optNode      = ""
  , optNonce     = 0
  }

options :: [OptDescr (Options -> Either String Options)]
options =
   [Option ['n'] ["nonce"] 
      (ReqArg
       (\ nc opts ->
          case read nc of
            nonc :: Int | nonc >= 0 -> Right opts { optNonce = nonc }
            _ -> Left "--nonce must be a non-negative integer"
       ) "Int")
     "REQUIRED; Should be greater than previous value."
  , Option ['r'] ["recipient"] 
      (ReqArg
       (\ rp opts -> 
           case stringAddress rp of
             Just eRecipient -> Right opts { optRecipient = eRecipient }
             Nothing -> Left "Invalid Recipient Address"
       ) "Address")
    "REQUIRED; The beneficiary address."
  , Option ['d'] ["node"] 
      (ReqArg
       (\ nd opts -> Right opts { optNode  = nd }) "Node IP Address")
    "REQUIRED; The node server IP address."
  , Option ['e'] ["remove"] 
      (NoArg
       (\ opts -> Right opts { optRemove = True}))
      "The voting direction"
   ]

parseArgs :: IO Options
parseArgs = do
  argv <- getArgs
  let header = "Usage: " ++ "blockstanbul-vote" ++ " [OPTION...]"
  let helpMessage = usageInfo header options
  case getOpt RequireOrder options argv of
    ([], [], []) -> ioError (userError ("Specify flags please" ++ "\n" ++ helpMessage))
    (opts, [], []) ->
      case foldlM (flip id) defaultOptions opts of
        Right opt -> return opt
        Left errorMessage -> ioError (userError (errorMessage ++ "\n" ++ helpMessage))
    (_, _, errs) -> ioError (userError (concat errs ++ helpMessage))

main :: IO()
main = do
  opt <- parseArgs
  putStrLn $ show opt
  pkey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
  let pk = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ C8.pack pkey
      sender = prvKey2Address pk
  esign <- signBenfInfo pk (optRecipient opt, (optRemove opt))
  let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
      vote = API.CandidateReceived{API.sender=sender
                                 , API.signature=esignStr
                                 , API.recipient=(optRecipient opt)
                                 , API.votingdir=(optRemove opt)
                                 , API.nonce=(optNonce opt)}
  API.uploadVote 80 (optNode opt) vote
