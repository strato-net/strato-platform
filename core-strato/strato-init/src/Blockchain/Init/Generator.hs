module Blockchain.Init.Generator where

import Blockchain.APIFiles
import Blockchain.Init.Protocol
import Blockchain.Init.EthConf
import Blockchain.Init.Options

mkAll :: String -> IO ()
mkAll _genesisBlockName = do
  ethconf <- genEthConf
  addEvent $ EthConf ethconf

  addEvent $ TopicList [(t, t) | t <- ["unminedblock", "statediff", "seq_vm_events", "seq_p2p_events"
                                      , "unseqevents", "jsonrpcresponse", "indexevents", "block"]]
  let bootnodes = if flags_addBootnodes
                    then Just $ filter (not . null) flags_stratoBootnode
                    else Nothing
  addEvent $ PeerList bootnodes

  addEvent $ ApiConfig $ stratoAPICerts ++ stratoAPIConfigDir
