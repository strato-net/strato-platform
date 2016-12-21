{-# LANGUAGE DeriveGeneric #-}

module Handler.Version where

import Import hiding ((</>), readFile)

--import Yesod.Table (Table)
--import qualified Yesod.Table as Table

import Versioning

data Repo = Repo { name :: String
                 , url :: String  
                 , sha :: String  
                 , branch :: String 
                 } deriving (Show, Generic)

instance ToJSON Repo



-- repoBasicInfoTable :: Table site Repo
-- repoBasicInfoTable = mempty
--   <> Table.string   "Name" (name)
--   <> Table.string   "Url"  (url)
--   <> Table.string   "SHA"  (sha)
--   <> Table.string "Branch" (branch)

-- getExampleRepoR = defaultLayout $ Table.buildBootstrap repoBasicInfoTable [(Repo "ethereum-client-haskell" "" $(gitHashEthereumClientHaskell) $(gitBranchEthereumClientHaskell))]

getVersionR :: Handler Value
getVersionR = do 

              addHeader "Access-Control-Allow-Origin" "*"
              --let genesis = liftIO $ initializeGenesisBlock
              --let sha = blockDataParentHash $ blockBlockData $ genesis

              --let deps = ["hserver-eth", "ethereum-rlp"]
              return $ object ["strato-p2p-client" .= Repo "strato-p2p-client" "" $(gitHashEthereumClientHaskell) $(gitBranchEthereumClientHaskell)
                              ,"ethereum-data-sql" .= Repo "ethereum-data-sql" "" $(gitHashEthereumDataSql) $(gitBranchEthereumDataSql)
                              ,"ethereum-encryption" .= Repo "ethereum-encryption" "" $(gitHashEthereumEncryption) $(gitBranchEthereumEncryption)
                              ,"merkle-patricia-db" .= Repo "merkle-patricia-db" "" $(gitHashEthereumMerklePatriciaDb) $(gitBranchEthereumMerklePatriciaDb)
                              ,"blockapps-tools" .= Repo "blockapps-tools" "" $(gitHashEthereumQuery) $(gitBranchEthereumQuery)
                              --,"ethereum-rlp" .= Repo "ethereum-rlp" "" $(gitHashEthereumRlp) $(gitBranchEthereumRlp)
                              ,"blockapps-util" .= Repo "blockapps-util" "" $(gitHashEthereumUtil) $(gitBranchEthereumUtil)
                              ,"miner-ethash" .= Repo "miner-ethash" "" $(gitHashHminer) $(gitBranchHminer)
                              ,"ethereum-vm" .= Repo "ethereum-vm" "" $(gitHashEthereumVm) $(gitBranchEthereumVm)
                              ,"strato-api" .= Repo "strato-api" "" $(gitHashHserverEth) $(gitBranchHServerEth)
                              --,"strato-quarry" .= Repo "strato-quarry" "" $(gitHashStratoQuarry) $(gitBranchStratoQuarry)
                              --,"strato-adit" .= Repo "strato-adit" "" $(gitHashStratoAdit) $(gitBranchStratoAdit)
                              --,"strato-conf" .= Repo "strato-conf" "" $(gitHashStratoConf) $(gitBranchStratoConf)
                              --,"strato-p2p-server" .= Repo "strato-p2p-server" $(gitHashP2pServer) $(gitBranchP2pServer)
                              --,"ethereum-discovery" .= Repo "ethereum-discovery" "" $(gitHashEthereumDiscovery) $(gitBranchEthereumDiscovery)
                              --,"blockapps-data" .= Repo "blockapps-data" "" $(gitHashBlockappsData) $(gitBranchBlockappsData)
                              --,"solidity-abi" .= Repo "solidity-abi" "" $(gitHashSolidityAbi) $(gitBranchSolidityAbi)

                              --,"stack.yaml" .= ("stack" :: String, $(stackYaml) :: String) --(liftIO $ getStackInfo)
                              ]
