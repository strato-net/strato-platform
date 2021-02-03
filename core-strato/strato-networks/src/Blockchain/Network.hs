
module Blockchain.Network where

import Blockchain.Strato.Model.Address

data PeerParams =
  NetworkParams {
    ethAddress::Address,
    webAddress::String
    }

getParams :: String -> IO (Maybe [PeerParams])
getParams _ = return Nothing
