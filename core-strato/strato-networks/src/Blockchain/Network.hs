
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
      ethAddress = Address 0x7d102f0afa763557acd0b5332f375013db2a760a,
      webAddress = "54.243.143.176"
--      webAddress = "engineering.stratoid.blockapps.net"
      }
  ]
getParams _ = return Nothing
