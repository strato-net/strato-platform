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
  , optUsername  :: Either IOError String
  , optPassword  :: Either IOError String
  } deriving Show

defaultOptions :: Options
defaultOptions  = Options
  { optRemove    = False
  , optRecipient = Left (userError ("Give me a recipient address."))
  , optNode      = Left (userError ("Give me a node."))
  , optNonce     = Left (userError ("Give me a non-negative int for your nonce."))
  , optUsername  = Left (userError ("Give me the username of the node."))
  , optPassword  = Left (userError ("Give me the password of the node."))
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
  , Option ['u'] ["username"]
      (ReqArg
       (\ user opts -> return opts { optUsername = Right user}
       ) "Node Username")
    "REQUIRED; The strato username of the running pbft node."
  , Option ['p'] ["password"]
      (ReqArg
       (\ pw opts -> return opts { optPassword = Right pw}
       ) "Node password")
      "REQUIRED; The strato password of the running pbft node."
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

fromOptRight :: Either IOError a -> a
fromOptRight (Right x) = x
fromOptRight (Left err) = error ("Input error: " ++ (show err) ++ "\n" ++ helpMessage)

main :: IO()
main = do
  opt <- parseArgs
  pkey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
  let pk = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ C8.pack pkey
      sender = prvKey2Address pk
  esign <- signBenfInfo pk (fromOptRight (optRecipient opt), (optRemove opt), fromOptRight (optNonce opt))
  let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
      vote = API.CandidateReceived{API.sender=sender
                                 , API.signature=esignStr
                                 , API.recipient= fromOptRight (optRecipient opt)
                                 , API.votingdir= not (optRemove opt)
                                 , API.nonce= fromOptRight (optNonce opt)}
  let urlAuth = concat [fromOptRight (optUsername opt) ++ ":",
       fromOptRight (optPassword opt) ++ "@",
       fromOptRight (optNode opt)]
  resultStr <- API.uploadVote 80 (urlAuth) vote
  putStrLn $ fromLeft "No result strings returned." resultStr
