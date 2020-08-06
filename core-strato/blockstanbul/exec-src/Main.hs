{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS -fno-warn-orphans    #-}

module Main where

import           Control.Exception
import           Control.Monad
import qualified Data.Aeson                 as Ae
import qualified Data.ByteString.Char8      as C8
import           Data.ByteString.Base16     as B16
import qualified Data.ByteString.Lazy       as BL
import           Data.Foldable (foldlM)
import           Data.List.Split            (splitOn)
import qualified Data.Text                  as T
import           Network.HTTP
import           Network.HTTP.Client        (newManager, defaultManagerSettings)
import           Network.HTTP.Auth
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
    url <- parseBaseUrl "http://vault-wrapper:8000/strato/v2.3"
    eSig <- runClientM (VC.postSignature (T.pack "nodekey") (VC.MsgHash bs)) (ClientEnv mgr url Nothing)
    case eSig of
      Left err -> die $ "failed to get message signature from the admin node's vault: " ++ show err
      Right sig -> return sig

  getPub = error "called getPub, but we shouldn't ever do that in blockstanbul-vote"
  getShared _ = error "called getShared, but we shouldn't ever do that in blockstanbul-vote"

data Options = Options
  { optRemove    :: Bool
  , optRecipient :: Address
  , optNodes     :: [String]
  , optNonce     :: Int
  } deriving Show

defaultOptions :: Options
defaultOptions  = Options
  { optRemove    = False
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
       (\ nd opts -> return opts { optNodes=(splitOn "," $ filter (/= ' ') nd) }
       ) "Nodes IP Addresses")
    "REQUIRED; The IP address(es) of the current voting node(s)."
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


main :: IO ()
main = do
  Options{..} <- parseArgs
  mgr <- newManager defaultManagerSettings
  vaultUrl <- parseBaseUrl "http://vault-wrapper:8000/strato/v2.3"
  optSender <- do 
    eAdAndKey <- runClientM (VC.getKey (T.pack "nodekey") Nothing) (ClientEnv mgr vaultUrl Nothing)
    case eAdAndKey of
      Left err -> die $ "failed to get address from the admin node's vault: " ++ show err
      Right adAndKey -> return $ VC.unAddress adAndKey
  
  putStrLn $ "Sender (admin node) address: " ++ show optSender
  putStrLn $ "Starting nonce: " ++ show optNonce
  printf $ "\n\nSending the vote to the following nodes: " ++ show optNodes
 
  let go [] _ = return ()
      go (nodeURL:xs) non = do
        esign <- signBenfInfo (optRecipient, not optRemove, non)
        
        let esignStr = C8.unpack
                     . B16.encode
                     . rlpSerialize
                     . rlpEncode $ esign
        let payload = CandidateReceived
                    { sender = optSender
                    , signature = esignStr
                    , recipient = optRecipient
                    , votingdir = not optRemove
                    , nonce = non
                    }
            body = C8.unpack $ BL.toStrict $ Ae.encode payload
        putStrLn $ "Request body: " ++ body
        let url = printf "http://%s/blockstanbul/vote" nodeURL
        putStrLn $ "Sending to url: " ++ url
        let req' = postRequestWithBody url "application/json" body
            auth = AuthBasic (error "realm unused")
                             "admin" -- I hope we can just hardcode this
                             "admin"
                             (error "uri unused")
            authStr = withAuthority auth req'
            req = insertHeaders [mkHeader HdrAuthorization authStr] req'

        eResp <- simpleHTTP req
        case eResp of
          Left err -> die $ "connection error: " ++ show err
          Right resp -> do
            print resp
            putStrLn $ "response: " ++ rspBody resp
    
        go xs $ non + 1
    
  go optNodes optNonce   
