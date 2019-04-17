{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
module Main where

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
       (\ username opts -> return opts { optUsername = Right username}
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
  skey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
  let bytes = fromRight (error "Invalid base64 NODEKEY") . B64.decode . C8.pack $ skey
      pkey = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
      iSender = prvKey2Address pkey
      iRecipient = fromOptRight $ optRecipient opt
      iVotingdir = optRemove opt
      iNonce = fromOptRight $ optNonce opt
      iHost = fromOptRight $ optNode opt
  putStrLn $ "Sender: " ++ show iSender
  esign <- signBenfInfo pkey (iRecipient, not iVotingdir, iNonce)
  putStrLn $ "Signature: " ++ show esign
  let esignStr = C8.unpack
               . B16.encode
               . rlpSerialize
               . rlpEncode $ esign
  putStrLn $ "esignStr: " ++ show esignStr
  let payload = CandidateReceived
              { sender = iSender
              , signature = esignStr
              , recipient = iRecipient
              , votingdir = iVotingdir
              , nonce = iNonce
              }
      body = C8.unpack $ BL.toStrict $ Ae.encode payload
  putStrLn $ "struct: " ++ show payload

  putStrLn $ "body: " ++ body
  let url = printf "http://%s/blockstanbul/vote" iHost
  putStrLn $ "url: " ++ url
  let req' = postRequestWithBody url "application/json" body
      auth = AuthBasic (error "realm unused")
                       (fromOptRight (optUsername opt))
                       (fromOptRight (optPassword opt))
                       (error "uri unused")
      authStr = withAuthority auth req'
      req = setHeaders req' [mkHeader HdrAuthorization authStr]
  print =<< simpleHTTP req
