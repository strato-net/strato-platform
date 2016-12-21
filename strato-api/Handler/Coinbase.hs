
module Handler.Coinbase where

import Import hiding ((</>), readFile)

import Blockchain.EthConf

getCoinbaseR :: Handler Value
getCoinbaseR = do 
  addHeader "Access-Control-Allow-Origin" "*"
  return $ object ["coinbase" .= coinbaseAddress (quarryConfig ethConf)]
