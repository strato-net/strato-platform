
module Blockchain.Network where

import Blockchain.Strato.Model.Address

data PeerParams =
  NetworkParams {
    ethAddress::Address,
    webAddress::String
    }

getParams :: String -> IO (Maybe [PeerParams])
getParams "oldblockappsnet" = return $ Just
  [
    NetworkParams {
      ethAddress = Address 0xeae0695468d78aa496259834855ed566e75bffcb,
      webAddress = "3.226.74.116"
      }
  ]
getParams "blockappsnet" = return $ Just
  [
    NetworkParams {
      ethAddress = Address 0xeae0695468d78aa496259834855ed566e75bffcb,
      webAddress = "54.243.143.176" -- "engineering.stratoid.blockapps.net"
      }
  ]
getParams _ = return Nothing
