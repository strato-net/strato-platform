{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
module Main where

import qualified Data.ByteString.Char8      as C8
import           Data.ByteString.Base16              as B16
import           Data.Either.Extra
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
  , optRecipient :: Either IOError Address
  , optNode      :: Either IOError String
  , optNonce     :: Either IOError Int
  } deriving Show

defaultOptions :: Options
defaultOptions  = Options
  { optRemove    = False
  , optRecipient = Left (userError ("Give me a recipient address."))
  , optNode      = Left (userError ("Give me a node."))
  , optNonce     = Left (userError ("Give me a non-negative int for your nonce."))
  }

options :: [OptDescr (Options -> IO Options)]
options =
   [Option ['n'] ["nonce"]
      (ReqArg
       (\ nc opts -> do
            let nonc = read nc :: Int
            if (nonc >= 0)
               then return $ opts { optNonce = Right nonc }
               else ioError $ fromLeft (userError "") (optNonce opts)
       ) "Int")
     "REQUIRED; Should be greater than previous value."
  , Option ['r'] ["recipient"]
      (ReqArg
       (\ rp opts -> do
           let strAddr = stringAddress rp
           case strAddr of
             Just eRecipient -> return opts { optRecipient = Right eRecipient }
             Nothing -> ioError $ fromLeft (userError "") (optRecipient opts)
       ) "Address")
    "REQUIRED; The beneficiary address."
  , Option ['d'] ["node"]
      (ReqArg
       (\ nd opts -> return opts { optNode  = Right nd }
       ) "Node IP Address")
    "REQUIRED; The node server IP address."
  , Option ['e'] ["remove"]
      (NoArg
       (\ opts -> return opts { optRemove = True}))
      "The voting direction"
   ]

helpMessage :: String
helpMessage = usageInfo header options
  where header = "Usage: " ++ "blockstanbul-vote" ++ " [OPTION...]"

parseArgs :: IO Options
parseArgs = do
  argv <- getArgs
  case getOpt RequireOrder options argv of
    ([], _, errs) -> ioError (userError (concat errs ++ helpMessage))
    (opts, _, _) -> foldlM (flip id) defaultOptions opts

fromright :: Either IOError a -> a
fromright (Right x) = x
fromright (Left _) = error ("See errors above." ++ "\n" ++ helpMessage)

main :: IO()
main = do
  opt <- parseArgs
  putStrLn $ show opt
  pkey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
  let pk = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ C8.pack pkey
      sender = prvKey2Address pk
  esign <- signBenfInfo pk (fromright (optRecipient opt), (optRemove opt), fromright (optNonce opt))
  let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
      vote = API.CandidateReceived{API.sender=sender
                                 , API.signature=esignStr
                                 , API.recipient= fromright (optRecipient opt)
                                 , API.votingdir= not (optRemove opt)
                                 , API.nonce= fromright (optNonce opt)}
  putStrLn $ show vote
  API.uploadVote 80 ("admin:admin@"++(fromright (optNode opt))) vote
