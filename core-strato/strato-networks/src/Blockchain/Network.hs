
module Blockchain.Network where

import Blockchain.Strato.Model.Address

data PeerParams =
  NetworkParams {
    ethAddress::Address,
    webAddress::String
    }

getParams :: String -> IO (Maybe [PeerParams])
getParams "blockappsnet" = return $ Just
  [
    NetworkParams {
      ethAddress = Address 0xeae0695468d78aa496259834855ed566e75bffcb,
      webAddress = "3.226.74.116"
      }
  ]
getParams _ = return Nothing
