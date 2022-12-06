{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS -fno-warn-orphans    #-}

module Main where

import           Control.Exception
import           Control.Monad
import qualified Data.ByteString.Char8      as C8
import           Data.ByteString.Base16     as B16
import           Data.Foldable (foldlM)
import           Data.List.Split            (splitOn)
import qualified Data.Text                  as T
import           Network.HTTP.Client        (newManager, defaultManagerSettings)
import           Network.HTTP.Simple
import           Network.HTTP.Types.Status
import           System.Console.GetOpt
import           System.Environment
import           System.Exit
import           Text.Printf

import           Blockchain.Blockstanbul.Authentication
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Strato.Model.Address
import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Secp256k1

import           Servant.Client
import qualified Strato.Strato23.API        as VC
import qualified Strato.Strato23.Client     as VC


instance HasVault IO where
  sign bs = do
    mgr <- newManager defaultManagerSettings
    url <- parseBaseUrl "http://strato:8013/strato/v2.3"
    eSig <- runClientM (VC.postSignature (T.pack "nodekey") (VC.MsgHash bs)) (mkClientEnv mgr url)
    case eSig of
      Left err -> die $ "failed to get message signature from the admin node's vault: " ++ show err
      Right sig -> return sig

  getPub = die "called getPub, but we shouldn't ever do that in blockstanbul-vote"
  getShared _ = die "called getShared, but we shouldn't ever do that in blockstanbul-vote"

data Options = Options
  { optRemove    :: Bool
  , optHTTPS     :: Bool
  , optRecipient :: Address
  , optNodes     :: [String]
  , optNonce     :: Int
  } deriving Show

defaultOptions :: Options
defaultOptions  = Options
  { optRemove    = False
  , optHTTPS     = False
  , optRecipient = throw $ userError "Give me a recipient address."
  , optNodes     = throw $ userError "Give me the node(s) to whom I'll send the vote."
  , optNonce     = throw $ userError "Give me a non-negative int for your nonce."
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
  , Option ['d'] ["nodes"]
      (ReqArg
       (\ nd opts -> return opts { optNodes=(splitOn "," nd) }
       ) "Nodes IP Addresses")
    "REQUIRED; The IP address(es) of the current voting node(s)."
  , Option ['e'] ["remove"]
      (NoArg
       (\ opts -> return opts { optRemove = True}))
      "The voting direction"
  , Option ['h'] ["https"]
      (NoArg
       (\ opts -> return opts { optHTTPS = True}))
      "Whether to use HTTPS"
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


main :: IO ()
main = do
  Options{..} <- parseArgs
  mgr <- newManager defaultManagerSettings
  vaultUrl <- parseBaseUrl "http://strato:8013/strato/v2.3"
  optSender <- do 
    eAdAndKey <- runClientM (VC.getKey (T.pack "nodekey") Nothing) (mkClientEnv mgr vaultUrl)
    case eAdAndKey of
      Left err -> die $ "failed to get address from the admin node's vault: " ++ show err
      Right adAndKey -> return $ VC.unAddress adAndKey
  
  putStrLn $ "Sender (admin node) address: " ++ show optSender
  putStrLn $ "Starting nonce: " ++ show optNonce
  printf $ "\nSending the vote to the following nodes: " ++ show optNodes
 
  let go [] _ = return ()
      go (nodeURL:xs) non = do
        esign <- signBenfInfo (optRecipient, not optRemove, non)
        
        let esignStr = C8.unpack
                     . B16.encode
                     . rlpSerialize
                     . rlpEncode $ esign
            payload = CandidateReceived
                    { sender = optSender
                    , signature = esignStr
                    , recipient = optRecipient
                    , votingdir = not optRemove
                    , nonce = non
                    }
            url = printf "http://%s/blockstanbul/vote" nodeURL
        
        putStrLn $ "\n\n\nsending the following request to " ++ nodeURL ++ ", HTTPS = " ++ show optHTTPS
        putStrLn $ show payload
        
        plainReq <- parseRequest url
        let postReq = setRequestMethod (C8.pack "POST") plainReq
            authReq = setRequestBasicAuth (C8.pack "admin") (C8.pack "admin") postReq
            bodyReq = setRequestBodyJSON payload authReq
            finalReq = if optHTTPS then setRequestSecure True bodyReq else bodyReq
        
        resp <- httpBS finalReq
        putStrLn $ "\nresponse status: " ++ (show $ getResponseStatus resp)
        putStrLn $ "response body: " ++ (show $ getResponseBody resp)

        case (statusCode $ getResponseStatus resp) of
          200 -> go xs $ non + 1
          _ -> die "vote failed. Terminating..."
    
  go optNodes optNonce   
