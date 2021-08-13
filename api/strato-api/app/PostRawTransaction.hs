{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}


module Main where


import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.Server.Transaction
import           BlockApps.Ethereum
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.SourceMap
import           Blockchain.Strato.Model.Wei


import           Data.Proxy
import qualified Data.Text                            as T
import qualified Data.Text.Encoding                   as T
import           Network.HTTP.Client        (newManager, defaultManagerSettings)
import           Servant.Client
import           Text.Format


postRawTransaction :: Maybe T.Text -> Maybe ChainId -> Bool -> PostBlocTransactionRawRequest
                   -> ClientM BlocChainOrTransactionResult 
postRawTransaction = client (Proxy @ PostBlocTransactionRaw)



-- let's see if we can post pre-signed transactions to STRATO! exciting stuff
main :: IO ()
main = do
  -- setup servant client
  mgr <- newManager defaultManagerSettings
  stratoURL <- parseBaseUrl "http://strato:3000/bloc/v2.2"
  let clientEnv = ClientEnv mgr stratoURL Nothing



  -- let's create a new user key + address
  priv <- newPrivateKey
  let addr = fromPrivateKey priv
  putStrLn $ "new user address: " ++ format addr




  -- let's make a contract creation TX
  let srcCode = T.unlines 
          [ "contract PreSignedTest { "
          , "    uint x;"
          , "    constructor() {"
          , "        x = 10;"
          , "    }"
          , "    function setX(uint val) {"
          , "        x = val;"
          , "    }"
          , "}"
          ]
      srcMap = unnamedSource srcCode 
      
      unsignedTx = UnsignedTransaction
        { unsignedTransactionNonce      = Nonce 1
        , unsignedTransactionGasPrice   = Wei 1
        , unsignedTransactionGasLimit   = Gas 2900000
        , unsignedTransactionTo         = Nothing
        , unsignedTransactionValue      = Wei 1
        , unsignedTransactionInitOrData = Code $ T.encodeUtf8 $ serializeSourceMap srcMap
        , unsignedTransactionChainId    = Nothing
        }
      txHash = rlpHash unsignedTx
      sig = signMsg priv txHash
      (r,s,v) = getSigVals sig


      -- try to post it with V value
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
          (Just v)
          Nothing
  
  putStrLn $ "unsigned transaction: " ++ show unsignedTx
  putStrLn $ "request with V: " ++ show request

  result <- runClientM (postRawTransaction Nothing Nothing True request) clientEnv
  putStrLn $ "result of posting with V: " ++ show result
      
      -- try without V



      -- try a function call
