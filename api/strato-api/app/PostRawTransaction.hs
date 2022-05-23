{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE RecordWildCards   #-}


module Main where


import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.Server.Transaction
import           BlockApps.Ethereum
-- import           BlockApps.Solidity.Parse.Parser     (parseXabi)
-- import           BlockApps.Solidity.Type
-- import           BlockApps.XAbiConverter             (funcToType)
import           BlockApps.X509


import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Secp256k1
import           Data.Source.Map
import           Blockchain.Strato.Model.Wei

import           Control.Exception

import qualified Data.Aeson                           as Ae
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL
import           Data.Foldable                        (foldlM)
import           Data.List                            (intercalate)
import           Data.List.Split                      (splitOn)
import qualified Data.Map.Strict                      as M
import           Data.Proxy
import qualified Data.Text                            as T
import qualified Data.Text.Encoding                   as T
import           Network.HTTP.Client                  (newManager, defaultManagerSettings)
import           Servant.Client
import           System.Console.GetOpt
import           System.Environment
import           Text.Format
import           Text.Printf



-- this tool makes transactions to send to the transaction/raw endpoint

--  try it out in your nearest strato docker container!
--      $ docker exec -it strato_strato_1 bash
--      $ post-raw-transaction




-- NOTE: will send TXs with SolidVM (EVM function call encoding is a pain)



---------------------------------- PARSE ARGS --------------------------------


data Options = Options 
  { optTxType        :: BlocTransactionType
  , optOmitV         :: Bool
  , optPrintOnly     :: Bool
  , optContractName  :: Maybe String
  , optSourceCode    :: Maybe SourceMap
  , optAddress       :: Maybe Address
  , optChainId       :: Maybe ChainId
  , optFunctionName  :: Maybe String
  , optFunctionArgs  :: Maybe [String]
  , optMetadata      :: M.Map T.Text T.Text
  , optNonce         :: Nonce
  , optValue         :: Wei
  , optKey           :: PrivateKey
  } deriving Show


defaultOptions :: Options
defaultOptions = Options
  { optTxType       = TRANSFER
  , optOmitV        = False
  , optPrintOnly    = False
  , optContractName = Nothing
  , optSourceCode   = Nothing
  , optAddress      = Nothing
  , optChainId      = Nothing
  , optFunctionName = Nothing
  , optFunctionArgs = Nothing
  , optMetadata     = M.empty
  , optNonce        = Nonce 0
  , optValue        = Wei 0
  , optKey          = throw $ userError "give me a private key with which to sign the TX" 
  }

options :: [OptDescr (Options -> IO Options)]
options = 
  [Option ['f'] ["function"]
      (NoArg
       (\ opts -> return opts{optTxType = FUNCTION})) 
   "Transaction type is a function call"
  , Option ['t'] ["transfer"]
      (NoArg
       (\ opts -> return opts{optTxType = TRANSFER})) 
   "Transaction type is a value transfer"
  , Option ['o'] ["omitV"]
      (NoArg
       (\ opts -> return opts{optOmitV = True})) 
   "Will omit \'V\' rec-id signature value in the transaction"
  , Option ['p'] ["printOnly"]
      (NoArg
       (\ opts -> return opts{optPrintOnly = True})) 
   "Will just print the request, not post it"
  , Option ['c'] ["contract"]
      (OptArg
       (\mC opts -> 
          case mC of
            Nothing -> return opts
            Just c -> return opts{optTxType = CONTRACT, optContractName = Just c}
       ) "String") 
   "Transaction type is a contract creation + the name of the contract to create"
  , Option ['s'] ["source"]
      (OptArg
       (\mS opts -> do
          case mS of 
            Nothing -> return opts
            Just s -> do
              src <- readFile s
              return opts{optSourceCode = Just $ namedSource (T.pack s) (T.pack src)}
       ) "FileName")
    "The filepath to the solidity source code of the contract you want to create" 
  , Option ['a'] ["address"]
      (OptArg
       (\mA opts -> 
          case mA of
            Nothing -> return opts
            Just a ->
              let strAddr = stringAddress a
              in case strAddr of
                   Just addr -> return opts{optAddress = Just addr}
                   Nothing -> ioError . userError . printf "invalid address: %s" $ show strAddr
       ) "Address")
    "The address of the contract you want to call, or the user to send value to"
  , Option ['i'] ["chainId"]
      (OptArg
       (\mC opts -> 
          case mC of
            Nothing -> return opts
            Just c ->
              let mCid = stringChainId c
              in case mCid of
                   Just cid -> return opts{optChainId = Just cid}
                   Nothing -> ioError . userError . printf "invalid chainId: %s" $ show c
       ) "ChainId")
    "The chainId on which to create the contract, of the contract you want to call, or of the user to send value to"
  , Option ['m'] ["funcName"]
      (OptArg
       (\fn opts -> return opts{optFunctionName = fn}
       ) "String")
    "The name of the contract function you want to call" 
  , Option ['r'] ["args"]
      (OptArg
       (\mR opts -> 
          case mR of
            Nothing -> return opts
            Just r -> return opts{optFunctionArgs = Just (splitOn "," r)}
       ) "(String,String,etc.)")
    "The comma-separated args of the contract function/constructor you want to call" 
  , Option ['d'] ["metadata"]
      (OptArg
       (\md opts -> 
          case md of
            Nothing -> return opts
            Just metadata -> do
              let mp = M.fromList $ map (\el ->
                          let (k:xs) = splitOn ":" el
                          in
                            (T.pack k, T.pack $ head xs)
                        ) $ splitOn "," metadata
              return opts{optMetadata = mp}
       ) "Key:Value,Key:Value")
    "The key-values of the transaction metadata" 
  , Option ['n'] ["nonce"]
      (ReqArg
       (\n opts -> do 
         return opts{optNonce = Nonce $ read n }
       ) "Nonce")
    "The user nonce to use for this transaction" 
  , Option ['v'] ["value"]
      (OptArg
       (\mV opts -> 
          case mV of 
            Nothing -> return opts 
            Just v -> return opts{optValue = Wei $ read v }
       ) "Integer")
    "The value to send for this transaction" 
  , Option ['k'] ["key"]
      (ReqArg
       (\k opts -> do
          pkeyBS <- B.readFile k
          let ePkey = bsToPriv pkeyBS
          case ePkey of
            Left err -> error err
            Right pkey -> return opts{optKey = pkey}
       ) "FileName")
    "The .pem filepath of the user's private key"
  ]

helpMessage :: String
helpMessage = usageInfo header options
  where header = "Usage: " ++ "post-raw-transaction" ++ " [OPTION...]"


parseArgs :: IO Options
parseArgs = do
  argv <- getArgs
  case getOpt Permute options argv of
    ([], _, errs) -> ioError (userError (concat errs ++ helpMessage))
    (opts, _, _) -> foldlM (flip id) defaultOptions opts


---------------------------------------------------------------------------------------




-- servant client for the endpoint
postRawTransaction :: Maybe T.Text -> Maybe ChainId -> Bool -> PostBlocTransactionRawRequest
                   -> ClientM BlocChainOrTransactionResult
postRawTransaction = client (Proxy @ PostBlocTransactionRaw)


makeArgs :: [String] -> String
makeArgs as = "(" ++ (intercalate "," as) ++ ")"


main :: IO ()
main = do
  Options{..} <- parseArgs


  -- the user's address 
  let addr = fromPrivateKey optKey
  putStrLn $ "user address: " ++ format addr


  -- parse TX type and figure out what to put for the metadata and txdata
  let (metadata, txData) = case optTxType of
        
        TRANSFER -> (M.empty, Code $ B.empty)
 
        CONTRACT -> case (optSourceCode, optContractName) of 
          (Just src, Just name) -> 
            let baseTup@(md,cd) = (M.fromList $ [
                                    ("VM", "SolidVM")
                                  , ("name", T.pack name)
                                  ] 
                                  , Code $ T.encodeUtf8 $ serializeSourceMap src
                                  )
            in case optFunctionArgs of 
              Nothing -> baseTup
              Just args -> (M.insert "args" (T.pack $ makeArgs args) md, cd)
          _ -> throw $ userError "source code or contract name not given for contract creation"

        FUNCTION -> do 
          case optFunctionName of
            Nothing -> throw $ userError "need a function name to call a function!"
            Just name -> case optFunctionArgs of
              Nothing -> (M.fromList $ [("VM", "SolidVM")], Code $ B.empty)
              Just args -> (M.fromList $
                            [ ("VM", "SolidVM")
                            , ("funcName", T.pack name)
                            , ("args", T.pack $ makeArgs args)
                            ]
                        , Code $ B.empty
                        )
        _ -> error "a logical impossibility! We parsed this TX as a GENESIS tx???"
  let metadata' = M.union metadata optMetadata

  -- create the unsigned transaction
  let unsignedTx = UnsignedTransaction
        { unsignedTransactionNonce      = optNonce
        , unsignedTransactionGasPrice   = Wei 10000        -- default val
        , unsignedTransactionGasLimit   = Gas 29000000000  -- default val
        , unsignedTransactionTo         = optAddress
        , unsignedTransactionValue      = optValue 
        , unsignedTransactionInitOrData = txData
        , unsignedTransactionChainId    = optChainId
        }
      txHash = rlpHash unsignedTx
      sig = signMsg optKey txHash
      (r,s,v) = getSigVals sig


      -- create the API request body
      request = PostBlocTransactionRawRequest
          addr
          (unsignedTransactionNonce unsignedTx)
          (unsignedTransactionGasPrice unsignedTx)
          (unsignedTransactionGasLimit unsignedTx)
          (unsignedTransactionTo unsignedTx)
          (unsignedTransactionValue unsignedTx)
          (unsignedTransactionInitOrData unsignedTx)
          (unsignedTransactionChainId unsignedTx)
          r
          s
          (if optOmitV then Nothing else Just v)
          (Just metadata')
  
  
  putStrLn $ "Transaction Hash: " ++ format txHash


  if optPrintOnly then do
    putStrLn "printOnly=true --> we will dump the request to the console, but not send it\n\n"
    BL.putStr $ Ae.encode request
  else do 
    putStrLn "printOnly=false --> we will post this transaction"

    -- setup servant client
    mgr <- newManager defaultManagerSettings
    stratoURL <- parseBaseUrl "http://strato:3000/bloc/v2.2"
    let clientEnv = ClientEnv mgr stratoURL Nothing

    -- post it
    result <- runClientM (postRawTransaction Nothing Nothing True request) clientEnv
    putStrLn $ "\n\nTransaction result: " ++ show result
      

