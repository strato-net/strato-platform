{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
module Main where

import           Control.Exception
import           Control.Monad
import qualified Data.Aeson                 as Ae
import qualified Data.ByteString.Char8      as C8
import qualified Data.ByteString.Base64     as B64
import           Data.ByteString.Base16     as B16
import qualified Data.ByteString.Lazy       as BL
import           Data.Either.Extra
import           Data.Foldable (foldlM)
import           Data.Maybe
import qualified Network.Haskoin.Crypto     as HK
import           Network.HTTP
import           Network.HTTP.Auth
import           System.Console.GetOpt
import           System.Environment
import           Text.Printf

import           Blockchain.Blockstanbul.Authentication
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Strato.Model.Address
import           Blockchain.Data.RLP

data Options = Options
  { optRemove    :: Bool
  , optRecipient :: Address
  , optNode      :: String
  , optNonce     :: Int
  , optUsername  :: String
  , optPassword  :: String
  } deriving Show

defaultOptions :: Options
defaultOptions  = Options
  { optRemove    = False
  , optRecipient = throw $ userError "Give me a recipient address."
  , optNode      = throw $ userError "Give me a node."
  , optNonce     = throw $ userError "Give me a non-negative int for your nonce."
  , optUsername  = throw $ userError "Give me the username of the node."
  , optPassword  = throw $ userError "Give me the password of the node."
  }

options :: [OptDescr (Options -> IO Options)]
options =
   [Option ['n'] ["nonce"]
      (ReqArg
       (\ nc opts -> do
            let nonc = read nc :: Int
            unless (nonc >= 0) $
              ioError . userError $ printf "nonnegative nonce required: %d" (show nonc)
            return opts{optNonce=nonc}
       ) "Int")
     "REQUIRED; Should be greater than previous value."
  , Option ['r'] ["recipient"]
      (ReqArg
       (\ rp opts -> do
           let strAddr = stringAddress rp
           case strAddr of
             Just eRecipient -> return opts { optRecipient = eRecipient }
             Nothing -> ioError . userError . printf "invalid address: %s" $ show strAddr
       ) "Address")
    "REQUIRED; The beneficiary address."
  , Option ['d'] ["node"]
      (ReqArg
       (\ nd opts -> return opts { optNode=nd }
       ) "Node IP Address")
    "REQUIRED; The node server IP address."
  , Option ['e'] ["remove"]
      (NoArg
       (\ opts -> return opts { optRemove = True}))
      "The voting direction"
  , Option ['u'] ["username"]
      (ReqArg
       (\ username opts -> return opts { optUsername = username}
       ) "Node Username")
    "REQUIRED; The strato username of the running pbft node."
  , Option ['p'] ["password"]
      (ReqArg
       (\ pw opts -> return opts { optPassword = pw}
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

main :: IO()
main = do
  Options{..} <- parseArgs
  skey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
  let bytes = fromRight (error "Invalid base64 NODEKEY") . B64.decode . C8.pack $ skey
      pkey = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
      optSender = prvKey2Address pkey
  putStrLn $ "Sender: " ++ show optSender
  esign <- signBenfInfo pkey (optRecipient, not optRemove, optNonce)
  putStrLn $ "Signature: " ++ show esign
  let esignStr = C8.unpack
               . B16.encode
               . rlpSerialize
               . rlpEncode $ esign
  putStrLn $ "esignStr: " ++ show esignStr
  let payload = CandidateReceived
              { sender = optSender
              , signature = esignStr
              , recipient = optRecipient
              , votingdir = not optRemove
              , nonce = optNonce
              }
      body = C8.unpack $ BL.toStrict $ Ae.encode payload
  putStrLn $ "struct: " ++ show payload

  putStrLn $ "body: " ++ body
  let url = printf "http://%s/blockstanbul/vote" optNode
  putStrLn $ "url: " ++ url
  let req' = postRequestWithBody url "application/json" body
      auth = AuthBasic (error "realm unused")
                       optUsername
                       optPassword
                       (error "uri unused")
      authStr = withAuthority auth req'
      req = insertHeaders [mkHeader HdrAuthorization authStr] req'
  putStrLn $ "request: " ++ show req
  print =<< simpleHTTP req
