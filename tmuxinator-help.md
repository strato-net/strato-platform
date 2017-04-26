## backbone
```
[2017-04-17 16:49:22.328273 UTC]                    src/Blockchain/Sequencer.hs:142 |  INFO |               setNextIngestedOffset | Setting checkpoint to Offset 393246
[2017-04-17 16:49:22.32996 UTC ]                    src/Blockchain/Sequencer.hs:124 |  INFO |                    readUnseqEvents' | Fetching unseqevents from Offset 393246
[2017-04-17 16:49:23.830003 UTC]                     src/Blockchain/Sequencer.hs:34 |  INFO |                           sequencer | Fetched 1 events)
[2017-04-17 16:49:23.830601 UTC]                     src/Blockchain/Sequencer.hs:92 | DEBUG |             transformEvents/emitTxs | Haven't witnessed MessageTx [4f0756b66ac051de8e9c5355fde331bd599e038aa24fd804726a87010bf86517] via API; emitting
[2017-04-17 16:49:23.831579 UTC]                     src/Blockchain/Sequencer.hs:39 |  INFO |                           sequencer | Have 0 pending LDB writes and 1 output events
[2017-04-17 16:49:23.832066 UTC]                     src/Blockchain/Sequencer.hs:41 |  INFO |                           sequencer | Applied pending LDB writes
[2017-04-17 16:49:23.83464 UTC ]                     src/Blockchain/Sequencer.hs:44 |  INFO |                           sequencer | Wrote 1 SeqEvents
[2017-04-17 16:49:23.834733 UTC]                    src/Blockchain/Sequencer.hs:142 |  INFO |               setNextIngestedOffset | Setting checkpoint to Offset 393247
[2017-04-17 16:49:23.899152 UTC]                    src/Blockchain/Sequencer.hs:124 |  INFO |                    readUnseqEvents' | Fetching unseqevents from Offset 393247
[2017-04-17 16:49:24.730831 UTC]                     src/Blockchain/Sequencer.hs:34 |  INFO |                           sequencer | Fetched 1 events)
[2017-04-17 16:49:24.732056 UTC]                    src/Blockchain/Sequencer.hs:104 |  INFO |          transformEvents/emitBlocks | Block #70691/bc9e10239a1b1f716e24197877e0dba9f4c790e0ceec38ddcc98ea4ec9b72356 (via Quarry, 1 txs) is ready to emit! Emitting it and chain of dependents.
[2017-04-17 16:49:24.733499 UTC]                     src/Blockchain/Sequencer.hs:39 |  INFO |                           sequencer | Have 1 pending LDB writes and 1 output events
[2017-04-17 16:49:24.73366 UTC ]                     src/Blockchain/Sequencer.hs:41 |  INFO |                           sequencer | Applied pending LDB writes
[2017-04-17 16:49:24.7351 UTC  ]                     src/Blockchain/Sequencer.hs:44 |  INFO |                           sequencer | Wrote 1 SeqEvents
[2017-04-17 16:49:24.735188 UTC]                    src/Blockchain/Sequencer.hs:142 |  INFO |               setNextIngestedOffset | Setting checkpoint to Offset 393248

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  |
[2017-04-17 16:49:23.853533 UTC]                   src/Blockchain/BlockChain.hs:530 |  INFO |                          printTx/ok |     ==============================================================================
[2017-04-17 16:49:23.855237 UTC]                       src/Blockchain/Bagger.hs:181 | DEBUG |                 Bagger.makeNewBlock | post-incremental run :: (20847950333872016169583701482093205529877465048663938959513446, f220a38862a5d81366aceade90590fad9c2ee2396f2a74adaf50412712dbc40f)
[2017-04-17 16:49:23.855364 UTC]                       src/Blockchain/Bagger.hs:414 |  INFO |         Bagger.buildFromMiningCache | Baggin' with difficultyBomb = False
[2017-04-17 16:49:23.855448 UTC]                       src/Blockchain/Bagger.hs:415 |  INFO |         Bagger.buildFromMiningCache | pre-reward :: (f220a38862a5d81366aceade90590fad9c2ee2396f2a74adaf50412712dbc40f)
[2017-04-17 16:49:23.86866 UTC ]                       src/Blockchain/Bagger.hs:417 |  INFO |         Bagger.buildFromMiningCache | post-reward :: (49c904654c5ccd812ddd62489d5770191c4971d832f67d6e443d958f758e4059)
[2017-04-17 16:49:23.868815 UTC]                    src/Executable/EthereumVM.hs:87 |  INFO |                   evm/loop/newBlock | calling produceUnminedBlocksM
[2017-04-17 16:49:23.890715 UTC]                   src/Executable/EthereumVM.hs:147 |  INFO |                       setCheckpoint | Setting checkpoint to Offset 349771 / EVMCheckpoint 67b48c347d8ba5a7 1
[2017-04-17 16:49:23.895508 UTC]                   src/Executable/EthereumVM.hs:135 |  INFO |                       getCheckpoint | Getting checkpoint for TopicName "seqevents_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3"#0 for ConsumerGroup "ethereum-vm_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3"
[2017-04-17 16:49:23.897579 UTC]                   src/Executable/EthereumVM.hs:141 |  INFO |                       getCheckpoint | Offset 349771 / EVMCheckpoint 67b48c347d8ba5a7 1
[2017-04-17 16:49:23.897765 UTC]                    src/Executable/EthereumVM.hs:58 |  INFO |                            evm/loop | Getting Blocks/Txs
[2017-04-17 16:49:23.897905 UTC]                   src/Executable/EthereumVM.hs:154 |  INFO |           getUnprocessedKafkaEvents | Fetching sequenced blockchain events with offset Offset 349771

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[2017-04-17 16:49:18.843955 UTC]                    src/Executable/StratoAdit.hs:89 |  INFO |                           doConsume | putTMVar w/ block #70691
[2017-04-17 16:49:18.844131 UTC]                    src/Executable/StratoAdit.hs:85 |  INFO |                           doConsume | Starting fetching blocks Offset 348011
[2017-04-17 16:49:19.019713 UTC]                    src/Executable/StratoAdit.hs:89 |  INFO |                           doConsume | putTMVar w/ block #70691
[2017-04-17 16:49:19.019969 UTC]                    src/Executable/StratoAdit.hs:85 |  INFO |                           doConsume | Starting fetching blocks Offset 348012
[2017-04-17 16:49:20.094397 UTC]                    src/Executable/StratoAdit.hs:89 |  INFO |                           doConsume | putTMVar w/ block #70691
[2017-04-17 16:49:20.094617 UTC]                    src/Executable/StratoAdit.hs:85 |  INFO |                           doConsume | Starting fetching blocks Offset 348013
[2017-04-17 16:49:21.190044 UTC]                    src/Executable/StratoAdit.hs:89 |  INFO |                           doConsume | putTMVar w/ block #70691
[2017-04-17 16:49:21.190276 UTC]                    src/Executable/StratoAdit.hs:85 |  INFO |                           doConsume | Starting fetching blocks Offset 348014
Sleeping for 3375459 milliseconds
[2017-04-17 16:49:22.030391 UTC]                    src/Executable/StratoAdit.hs:47 |  INFO |                   mineBlock/success | Mining success after passes: 0 for miner 1 with 0 hash/s
[2017-04-17 16:49:22.030593 UTC]                    src/Executable/StratoAdit.hs:47 |  INFO |                             doBlock | Coinbase a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6 success for 19d2d12a31ab6dd10827f1f50141d0dcd27092917c8c3b93125f496006c97d38 -> 6
[2017-04-17 16:49:22.03102 UTC ]                    src/Executable/StratoAdit.hs:47 |  INFO |                             doBlock | New block hash is 67b48c347d8ba5a7adf7be6cdd37dad58f148ea4e78b7c3461d1516314e1b9d1!
[2017-04-17 16:49:22.268414 UTC]                    src/Executable/StratoAdit.hs:89 |  INFO |                           doConsume | putTMVar w/ block #70691
[2017-04-17 16:49:22.26858 UTC ]                    src/Executable/StratoAdit.hs:85 |  INFO |                           doConsume | Starting fetching blocks Offset 348015
[2017-04-17 16:49:22.406646 UTC]                    src/Executable/StratoAdit.hs:89 |  INFO |                           doConsume | putTMVar w/ block #70691
[2017-04-17 16:49:22.406831 UTC]                    src/Executable/StratoAdit.hs:85 |  INFO |                           doConsume | Starting fetching blocks Offset 348016
[2017-04-17 16:49:23.890795 UTC]                    src/Executable/StratoAdit.hs:89 |  INFO |                           doConsume | putTMVar w/ block #70691
[2017-04-17 16:49:23.890973 UTC]                    src/Executable/StratoAdit.hs:85 |  INFO |                           doConsume | Starting fetching blocks Offset 348017

[s0] 0:host- 1:backbone* 2:indexers  3:network  4:strato-api  5:misc-api  6:explorer  7:graphs  8:stream_blocks  9:stream_seq  10:checkpoints  11:cirrus  12:monitor  13:databases   "Block #70690" 16:49 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 16:49 17-Apr-17
```

## indexers
```
[2017-04-17 16:50:26.579747 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:35 |  INFO |                          apiIndexer | About to fetch blocks
[2017-04-17 16:50:26.581078 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:38 |  INFO |                          apiIndexer | Fetched 1 events starting from Offset 255833
[2017-04-17 16:50:26.600374 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:43 |  INFO |                          apiIndexer | 0 of them are blocks
[2017-04-17 16:50:26.600515 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:65 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255834 / IndexerBestBlockInfo (BlockKey {unBlockKey = SqlBackendKey {unSqlBackendKey = 153009}})
[2017-04-17 16:50:26.602709 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:35 |  INFO |                          apiIndexer | About to fetch blocks
[2017-04-17 16:50:29.004885 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:38 |  INFO |                          apiIndexer | Fetched 1 events starting from Offset 255834
[2017-04-17 16:50:29.005061 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:43 |  INFO |                          apiIndexer | 1 of them are blocks
[2017-04-17 16:50:29.00567 UTC ]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:45 |  INFO |                          apiIndexer |   (inserting 1 output blocks)
[2017-04-17 16:50:29.030947 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:65 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255835 / IndexerBestBlockInfo (BlockKey {unBlockKey = SqlBackendKey {unSqlBackendKey = 153009}})
[2017-04-17 16:50:29.032102 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:35 |  INFO |                          apiIndexer | About to fetch blocks
[2017-04-17 16:50:29.034202 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:38 |  INFO |                          apiIndexer | Fetched 1 events starting from Offset 255835
[2017-04-17 16:50:29.034327 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:43 |  INFO |                          apiIndexer | 0 of them are blocks
[2017-04-17 16:50:29.034648 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:65 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255836 / IndexerBestBlockInfo (BlockKey {unBlockKey = SqlBackendKey {unSqlBackendKey = 153009}})
[2017-04-17 16:50:29.035794 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:35 |  INFO |                          apiIndexer | About to fetch blocks
[2017-04-17 16:50:32.026934 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:38 |  INFO |                          apiIndexer | Fetched 1 events starting from Offset 255836
[2017-04-17 16:50:32.027108 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:43 |  INFO |                          apiIndexer | 1 of them are blocks
[2017-04-17 16:50:32.027245 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:45 |  INFO |                          apiIndexer |   (inserting 1 output blocks)
[2017-04-17 16:50:32.07333 UTC ]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:65 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255837 / IndexerBestBlockInfo (BlockKey {unBlockKey = SqlBackendKey {unSqlBackendKey = 153011}})
[2017-04-17 16:50:32.076472 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:35 |  INFO |                          apiIndexer | About to fetch blocks
[2017-04-17 16:50:32.078885 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:38 |  INFO |                          apiIndexer | Fetched 1 events starting from Offset 255837
[2017-04-17 16:50:32.079037 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:43 |  INFO |                          apiIndexer | 0 of them are blocks
[2017-04-17 16:50:32.079171 UTC]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:65 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255838 / IndexerBestBlockInfo (BlockKey {unBlockKey = SqlBackendKey {unSqlBackendKey = 153011}})
[2017-04-17 16:50:32.08108 UTC ]     src/Blockchain/Strato/Indexer/ApiIndexer.hs:35 |  INFO |                          apiIndexer | About to fetch blocks

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
edb7570dd3374857e
[2017-04-17 16:50:26.559408 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:60 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255833
[2017-04-17 16:50:26.560859 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:34 |  INFO |                          p2pIndexer | About to fetch IndexEvents
[2017-04-17 16:50:26.56189 UTC ]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:36 |  INFO |                          p2pIndexer | Fetched 1 events starting from Offset 255833
[2017-04-17 16:50:26.561993 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:44 |  INFO |                          p2pIndexer | Updating RedisBestBlock as (0120dfb43c7a70969d18b3be89a3aa34c14273795011be6edb7570dd3374857e, 70705, 579272368)
[2017-04-17 16:50:27.082834 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:60 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255834
[2017-04-17 16:50:27.084195 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:34 |  INFO |                          p2pIndexer | About to fetch IndexEvents
[2017-04-17 16:50:28.986486 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:36 |  INFO |                          p2pIndexer | Fetched 1 events starting from Offset 255834
[2017-04-17 16:50:28.986693 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:41 |  INFO |                          p2pIndexer | Inserting Redis block with sha: 80c2d1248b134c459fa8a823cfb29b4bf04e89cc2eba9ed9e902e1b966272fa5
[2017-04-17 16:50:28.997151 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:60 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255835
[2017-04-17 16:50:29.001862 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:34 |  INFO |                          p2pIndexer | About to fetch IndexEvents
[2017-04-17 16:50:29.00741 UTC ]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:36 |  INFO |                          p2pIndexer | Fetched 1 events starting from Offset 255835
[2017-04-17 16:50:29.007629 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:44 |  INFO |                          p2pIndexer | Updating RedisBestBlock as (80c2d1248b134c459fa8a823cfb29b4bf04e89cc2eba9ed9e902e1b966272fa5, 70705, 579272384)
[2017-04-17 16:50:29.400925 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:60 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255836
[2017-04-17 16:50:29.401815 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:34 |  INFO |                          p2pIndexer | About to fetch IndexEvents
[2017-04-17 16:50:32.027532 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:36 |  INFO |                          p2pIndexer | Fetched 1 events starting from Offset 255836
[2017-04-17 16:50:32.027757 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:41 |  INFO |                          p2pIndexer | Inserting Redis block with sha: 85dc313aeb8b3f11c8da0ecb39170d671b233eb1e701162a40107c017d0baad2
[2017-04-17 16:50:32.052065 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:60 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255837
[2017-04-17 16:50:32.055544 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:34 |  INFO |                          p2pIndexer | About to fetch IndexEvents
[2017-04-17 16:50:32.057819 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:36 |  INFO |                          p2pIndexer | Fetched 1 events starting from Offset 255837
[2017-04-17 16:50:32.057935 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:44 |  INFO |                          p2pIndexer | Updating RedisBestBlock as (85dc313aeb8b3f11c8da0ecb39170d671b233eb1e701162a40107c017d0baad2, 70706, 579280560)
[2017-04-17 16:50:32.483362 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:60 |  INFO |                  setKafkaCheckpoint | Setting checkpoint to Offset 255838
[2017-04-17 16:50:32.484718 UTC]     src/Blockchain/Strato/Indexer/P2PIndexer.hs:34 |  INFO |                          p2pIndexer | About to fetch IndexEvents

[s0] 0:host  1:backbone- 2:indexers* 3:network  4:strato-api  5:misc-api  6:explorer  7:graphs  8:stream_blocks  9:stream_seq  10:checkpoints  11:cirrus  12:monitor  13:d> "bash  /home/blockapps" 16:50 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 16:50 17-Apr-17
```

## network
```
[2017-04-17 17:07:49.806788 UTC]  INFO |                                     | timeout triggered        │
[2017-04-17 17:07:49.843346 UTC]  INFO |                                     | no peers available to boo│{
tstrap from, will try again soon.                                                                       │  "serverPeers": [
[2017-04-17 17:07:59.851364 UTC]  INFO |                                     | timeout triggered        │    "172.20.0.7:38908"
[2017-04-17 17:07:59.871658 UTC]  INFO |                                     | no peers available to boo│  ],
tstrap from, will try again soon.                                                                       │  "clientPeers": {
[2017-04-17 17:08:09.88106 UTC ]  INFO |                                     | timeout triggered        │    "error": "connect: does not exist (Connection refused)"
[2017-04-17 17:08:09.908164 UTC]  INFO |                                     | no peers available to boo│  }
tstrap from, will try again soon.                                                                       │}
[2017-04-17 17:08:19.920305 UTC]  INFO |                                     | timeout triggered        │Network best blocks
[2017-04-17 17:08:19.954583 UTC]  INFO |                                     | no peers available to boo│strato_strato_1 70993
tstrap from, will try again soon.                                                                       │clientsPeers:
[2017-04-17 17:08:29.963871 UTC]  INFO |                                     | timeout triggered        │error   serverPeers:
[2017-04-17 17:08:29.986975 UTC]  INFO |                                     | no peers available to boo│172.20.0.7      33596
tstrap from, will try again soon.                                                                       │
[2017-04-17 17:08:39.997497 UTC]  INFO |                                     | timeout triggered        │
[2017-04-17 17:08:40.037679 UTC]  INFO |                                     | no peers available to boo│
tstrap from, will try again soon.                                                                       │
[2017-04-17 17:08:50.06094 UTC ]  INFO |                                     | timeout triggered        │
[2017-04-17 17:08:50.08094 UTC ]  INFO |                                     | no peers available to boo│
tstrap from, will try again soon.                                                                       │
[2017-04-17 17:09:00.090649 UTC]  INFO |                                     | timeout triggered        │
[2017-04-17 17:09:00.110176 UTC]  INFO |                                     | no peers available to boo│
tstrap from, will try again soon.                                                                       │
[2017-04-17 17:09:10.127918 UTC]  INFO |                                     | timeout triggered        │
[2017-04-17 17:09:10.149059 UTC]  INFO |                                     | no peers available to boo│
tstrap from, will try again soon.                                                                       │
                                                                                                        │
────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────
[2017-04-16 09:01:25.24642 UTC ]  INFO |                                     | Connection ended:[7/1898]│        parentHash: c39327861bff3b294c5f762c1bf20259409dc74b74f901f2a1fb982ecc976bc9
: does not exist (Connection refused)                                                                   │        unclesHash: 1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347 (the empty array)
[2017-04-16 09:01:25.277866 UTC]  INFO |                                     | No available peers, I wil│        coinbase: a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6
l try to find available peers again in 10 seconds                                                       │        stateRoot: 55c063b7181089e5565d1c786939c8d434b1092b52a37784922b560d189fbac2
[2017-04-16 09:01:35.295334 UTC]  INFO |                                     | No available peers, I wil│        transactionsRoot: b36c0c8c169c47fc1b709f4241732d14d6556d74dd58065cf6aab3ed6b605dc4
l try to find available peers again in 10 seconds                                                       │        receiptsRoot: <empty>
[2017-04-16 09:01:45.306679 UTC]  INFO |                                     | No available peers, I wil│        difficulty: 8192
l try to find available peers again in 10 seconds                                                       │        gasLimit: 134106750954043285260542398166573574341956348953988570
[2017-04-16 09:01:55.325165 UTC]  INFO |                                     | No available peers, I wil│        gasUsed: 0
l try to find available peers again in 10 seconds                                                       │        timestamp: 2017-04-16 20:14:32 UTC
[2017-04-16 09:02:05.340426 UTC]  INFO |                                     | No available peers, I wil│        extraData: 0
l try to find available peers again in 10 seconds                                                       │        nonce: 6
[2017-04-16 09:02:15.350521 UTC]  INFO |                                     | No available peers, I wil│        Message Transaction
l try to find available peers again in 10 seconds                                                       │                tNonce: 36315
[2017-04-16 09:02:25.397215 UTC]  INFO |                                     | Welcome to strato-p2p-cli│                gasPrice: 50000000000
ent                                                                                                     │                tGasLimit: 100000
[2017-04-16 09:02:25.397344 UTC]  INFO |                                     | =========================│                to: 0000000000000000000000000000000000000123
===                                                                                                     │                value: 1000000000000000000000
[2017-04-16 09:02:25.39739 UTC ]  INFO |                                     | now on steroids too      │                tData:
[2017-04-16 09:02:25.39743 UTC ]  INFO |                                     |  * Attempting to connect │
to 172.20.0.7:36595                                                                                     │                hash: d2cbbbddc4a423c2d3b7e06de8eed2b0e453ed556d7b9f21cb4d56fac2fdf691
[2017-04-16 09:02:25.39757 UTC ]  INFO |                                     |  * my pubkey is: e9e6050a│                        (no uncles)
0bba9cf3733e874afeea18...                                                                               │[2017-04-16 20:14:36.243137 UTC]                src/Blockchain/SeqEventNotify.hs:29 |  INFO |
[2017-04-16 09:02:25.399731 UTC]  INFO |                                     |  * server pubkey is : f11│         seqEventNotify | read kafka seqevents @ Offset 251949
1167be3dc11351284b70ec8159a...                                                                          │[2017-04-16 20:14:37.125747 UTC]                src/Blockchain/SeqEventNotify.hs:29 |  INFO |
[2017-04-16 09:02:25.400612 UTC]  INFO |                                     | Connection ended: connect│         seqEventNotify | read kafka seqevents @ Offset 251950
: does not exist (Connection refused)                                                                   │[2017-04-16 20:14:37.266055 UTC]                src/Blockchain/SeqEventNotify.hs:29 |  INFO |
[2017-04-16 09:02:25.407558 UTC]  INFO |                                     | No available peers, I wil│         seqEventNotify | read kafka seqevents @ Offset 251951
l try to find available peers again in 10 seconds                                                       │
[s0] 0:host  1:backbone  2:indexers- 3:network* 4:strato-api  5:misc-api  6:explorer  7:graphs  8:stream_blocks  9:stream_seq  10:checkpoints  11:cirrus  12:monitor  13:d> "docker  /home/blockap" 17:09 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 17:09 17-Apr-17
```

## strato-api
```
2017-04-17T17:10:20.554137359Z 17/Apr/2017:17:10:20 +0000 [Debug] Kafka commit: [ProduceResp {_produceResponseFields = [(TopicName "unseqevents_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3",[(Partition 0,NoError,Offset 394914)])]}] @(strato-api-0.0.0-5da1NiVOMDSCcnww0cb0iu:Handler.Faucet ./Handler/Faucet.hs:47:24)
2017-04-17T17:10:20.554167959Z 172.20.0.1 - - [17/Apr/2017:17:10:20 +0000] "POST /eth/v1.2/faucet HTTP/1.1" 200 20 "" "curl/7.47.0"
2017-04-17T17:10:20.554173259Z POST /eth/v1.2/faucet
2017-04-17T17:10:20.554176759Z   Params: [("address","123")]
2017-04-17T17:10:20.554180059Z   Request Body: address=123
2017-04-17T17:10:20.554182959Z   Accept: */*
2017-04-17T17:10:20.554185959Z   Status: 200 OK 0.29301s
--
2017-04-17T17:10:21.619287782Z 17/Apr/2017:17:10:21 +0000 [Debug] Kafka commit: [ProduceResp {_produceResponseFields = [(TopicName "unseqevents_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3",[(Partition 0,NoError,Offset 394916)])]}] @(strato-api-0.0.0-5da1NiVOMDSCcnww0cb0iu:Handler.Faucet ./Handler/Faucet.hs:47:24)
2017-04-17T17:10:21.619318982Z 172.20.0.1 - - [17/Apr/2017:17:10:21 +0000] "POST /eth/v1.2/faucet HTTP/1.1" 200 20 "" "curl/7.47.0"
2017-04-17T17:10:21.619323882Z POST /eth/v1.2/faucet
2017-04-17T17:10:21.619327082Z   Params: [("address","123")]
2017-04-17T17:10:21.619336382Z   Request Body: address=123
2017-04-17T17:10:21.619339482Z   Accept: */*
2017-04-17T17:10:21.619342482Z   Status: 200 OK 0.05055s
--
2017-04-17T17:10:22.740913191Z 17/Apr/2017:17:10:22 +0000 [Debug] Kafka commit: [ProduceResp {_produceResponseFields = [(TopicName "unseqevents_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3",[(Partition 0,NoError,Offset 394917)])]}] @(strato-api-0.0.0-5da1NiVOMDSCcnww0cb0iu:Handler.Faucet ./Handler/Faucet.hs:47:24)
2017-04-17T17:10:22.740945491Z 172.20.0.1 - - [17/Apr/2017:17:10:22 +0000] "POST /eth/v1.2/faucet HTTP/1.1" 200 20 "" "curl/7.47.0"
2017-04-17T17:10:22.740950491Z POST /eth/v1.2/faucet
2017-04-17T17:10:22.740958991Z   Params: [("address","123")]
2017-04-17T17:10:22.740963591Z   Request Body: address=123
2017-04-17T17:10:22.740966591Z   Accept: */*
2017-04-17T17:10:22.740969691Z   Status: 200 OK 0.093451s

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
2017-04-17T17:10:19.117627908Z   Status: 200 OK 0.340212s
--
2017-04-17T17:10:20.554137359Z 17/Apr/2017:17:10:20 +0000 [Debug] Kafka commit: [ProduceResp {_produceResponseFields = [(TopicName "unseqevents_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3",[(Partition 0,NoError,Offset 394914)])]}] @(strato-api-0.0.0-5da1NiVOMDSCcnww0cb0iu:Handler.Faucet ./Handler/Faucet.hs:47:24)
2017-04-17T17:10:20.554167959Z 172.20.0.1 - - [17/Apr/2017:17:10:20 +0000] "POST /eth/v1.2/faucet HTTP/1.1" 200 20 "" "curl/7.47.0"
2017-04-17T17:10:20.554173259Z POST /eth/v1.2/faucet
2017-04-17T17:10:20.554176759Z   Params: [("address","123")]
2017-04-17T17:10:20.554180059Z   Request Body: address=123
2017-04-17T17:10:20.554182959Z   Accept: */*
2017-04-17T17:10:20.554185959Z   Status: 200 OK 0.29301s
--
2017-04-17T17:10:21.619287782Z 17/Apr/2017:17:10:21 +0000 [Debug] Kafka commit: [ProduceResp {_produceResponseFields = [(TopicName "unseqevents_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3",[(Partition 0,NoError,Offset 394916)])]}] @(strato-api-0.0.0-5da1NiVOMDSCcnww0cb0iu:Handler.Faucet ./Handler/Faucet.hs:47:24)
2017-04-17T17:10:21.619318982Z 172.20.0.1 - - [17/Apr/2017:17:10:21 +0000] "POST /eth/v1.2/faucet HTTP/1.1" 200 20 "" "curl/7.47.0"
2017-04-17T17:10:21.619323882Z POST /eth/v1.2/faucet
2017-04-17T17:10:21.619327082Z   Params: [("address","123")]
2017-04-17T17:10:21.619336382Z   Request Body: address=123
2017-04-17T17:10:21.619339482Z   Accept: */*
2017-04-17T17:10:21.619342482Z   Status: 200 OK 0.05055s
--
2017-04-17T17:10:22.740913191Z 17/Apr/2017:17:10:22 +0000 [Debug] Kafka commit: [ProduceResp {_produceResponseFields = [(TopicName "unseqevents_cd23a26d2fe4e9503c4a0e74e7313f896a2cbcb3",[(Partition 0,NoError,Offset 394917)])]}] @(strato-api-0.0.0-5da1NiVOMDSCcnww0cb0iu:Handler.Faucet ./Handler/Faucet.hs:47:24)
2017-04-17T17:10:22.740945491Z 172.20.0.1 - - [17/Apr/2017:17:10:22 +0000] "POST /eth/v1.2/faucet HTTP/1.1" 200 20 "" "curl/7.47.0"
2017-04-17T17:10:22.740950491Z POST /eth/v1.2/faucet
2017-04-17T17:10:22.740958991Z   Params: [("address","123")]
2017-04-17T17:10:22.740963591Z   Request Body: address=123
2017-04-17T17:10:22.740966591Z   Accept: */*
2017-04-17T17:10:22.740969691Z   Status: 200 OK 0.093451s

[s0] 0:host  1:backbone  2:indexers  3:network- 4:strato-api* 5:misc-api  6:explorer  7:graphs  8:stream_blocks  9:stream_seq  10:checkpoints  11:cirrus  12:monitor  13:d> "docker  /home/blockap" 17:10 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 17:10 17-Apr-17
```

## explorer
```
                                                                                                        │
[                                                                                                       │[
  {                                                                                                     │  {
    "next": "",                                                                                         │    "transactionType": "Transfer",
    "kind": "Block",                                                                                    │    "origin": "API",
    "blockUncles": [],                                                                                  │    "next": "",
    "receiptTransactions": [                                                                            │    "hash": "b7cbad9ce794b2ed563349053702ec107eeab2b83e99a20612b13ed2a03f419d",
      {                                                                                                 │    "gasLimit": 100000,
        "transactionType": "Transfer",                                                                  │    "codeOrData": "",
        "hash": "cbcd3545f957e21b82eee051aaec12a05906bb600d52b550ae10e80e679ab414",                     │    "gasPrice": 50000000000,
        "gasLimit": 100000,                                                                             │    "to": "123",
        "kind": "Transaction",                                                                          │    "value": "1000000000000000000000",
        "data": "",                                                                                     │    "from": "e1fd0d4a52b75a694de8b55528ad48e2e2cf7859",
        "gasPrice": 50000000000,                                                                        │    "blockNumber": 70649,
        "to": "123",                                                                                    │    "r": "190384567b17673a34544eacb156c644523cc19f17575eebac2cc6c42ad19441",
        "value": 1e+21,                                                                                 │    "s": "6e7c7585d769593dd58af13a14c72a09577f023ce889a19909ec364f5e32cdf1",
        "from": "e1fd0d4a52b75a694de8b55528ad48e2e2cf7859",                                             │    "timestamp": "2017-04-17 16:46:12.151463 UTC",
        "r": "22f61fb627731757f5bd8009ca0378e6a4727484f0b39f0d9e6cd98068580c51",                        │    "v": "1c",
        "s": "1ea076831b9b573fe4a477c931ef407453165b76918fb033e21e2176c0d68e39",                        │    "nonce": 52129
        "v": "1c",                                                                                      │  }
        "nonce": 52130                                                                                  │]
      }                                                                                                 │
    ],                                                                                                  │
    "blockData": {                                                                                      │
      "extraData": 0,                                                                                   │
      "gasUsed": 0,                                                                                     │
      "gasLimit": 2.0049660063309123e+61,                                                               │
      "kind": "BlockData",                                                                              │
────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────
Every 60.0s: docker exec strato_strato_1 bash -c "curl -s localhost:3000/ve...  Mon Apr 17 16:45:56 2017│Every 5.0s: docker exec strato_strato_1 bash -c "curl -s localhost:3000/eth/v...  Mon Apr 17 16:46:18 2017
                                                                                                        │
{                                                                                                       │    100 "a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6"
  "monostrato": {                                                                                       │
    "sha": "679dfd27e1ac5973bd233b1430e96c978008191d",                                                  │
    "url": "",                                                                                          │
    "branch": "monostrato-cutover",                                                                     │
    "name": "monostrato"                                                                                │
  }                                                                                                     │
}                                                                                                       │
{                                                                                                       │
  "coinbase": "a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6"                                                │
}                                                                                                       │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
                                                                                                        │
[s0] 0:host  1:backbone  2:indexers  3:network  4:strato-api  5:misc-api  6:explorer* 7:graphs- 8:stream_blocks  9:stream_seq  10:checkpoints  11:cirrus  12:monitor  13:d> "watch  /home/blockapp" 16:46 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 16:46 17-Apr-17
```

## graphs

```

Blocktimes
▆▃▂█▃▆▂▄▆▄▆▃▅▆▅▆▄▄▆▄▆▂▂█▂▆▄▄▇▂▆▃▂█▂▆▄▅▆▄▆▄▂█▂▆▅▂▇▄▆▅▃▃▆▃▆▂▂█▂▆▁█▂▆▃▆▂▆▂▇▃▆▂█▂▇▂▇▃▆▄▆▃▂▇▂▆▃▃█▂▆▂▆▂▇▁     blocktimes














───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Every 20.0s: ./watcher.sh explorer-numtxs strato_strato_1                                                                                                                                  Mon Apr 17 17:10:41 2017

Number of transactions per block
█▁████▁████▁████▁████▁████▁████▁████▁████▁████▁█▁███▁████▁████████████████████▁▁████▁████▁██████████    number of transactions per block














───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Every 20.0s: ./watcher.sh explorer-numuncles strato_strato_1                                                                                                                               Mon Apr 17 17:10:47 2017

Number of uncles per block
▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅    number of uncles per block

















[s0] 0:host  1:backbone  2:indexers  3:network  4:strato-api  5:misc-api- 6:explorer  7:graphs* 8:stream_blocks  9:stream_seq  10:checkpoints  11:cirrus  12:monitor  13:d> "watch  /home/blockapp" 17:10 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 17:10 17-Apr-17
```

## stream_seq

```
    receiptsRoot: <empty>                                           │42aca3f01b                                                            │{"updatedAccounts":{"a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6":{"contra
    difficulty: 8196                                                │    unclesHash: 1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142│ctRoot":null,"balance":{"oldValue":2135138600000000000000,"newValue":21
    gasLimit: 23277839875953090603424296717618                      │fd40d49347 (the empty array)                                          │40138600000000000000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2
    gasUsed: 0                                                      │    coinbase: ccda5fc564b61cca7f14b584b29f0d54fd2d599d                │dcc703c0e500b653ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
    timestamp: 2017-04-14 20:14:56 UTC                              │    stateRoot: 4b4c47bc9c3351141bd71c058c25fb237d795f1e7003e55f94c2646│{"updatedAccounts":{"00000000000000000123":{"contractRoot":null,"balanc
    extraData: 0                                                    │f00fd6fb4                                                             │e":{"oldValue":255000000000000000000000,"newValue":25600000000000000000
    nonce: 6                                                        │    transactionsRoot: <empty>                                         │0000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2dcc703c0e500b653
            (no transactions)                                       │    receiptsRoot: <empty>                                             │ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
            (no uncles)                                             │    difficulty: 8196                                                  │{"updatedAccounts":{"a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6":{"contra
Block #34 (via Peer f111167be3dc11351284b70ec8159af629ffe9168df9576a│    gasLimit: 28406652714000428885421648467140                        │ctRoot":null,"balance":{"oldValue":2140138600000000000000,"newValue":21
64b230f7a694d6952acffb63d34a5a4f2a4f196199117881a79e170d42cd6700ee36│    gasUsed: 0                                                        │40139650000000000000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2
a7879541f6f2@172.20.0.7:36595) bd0f04fd33167daf223f89b863b4cdc2098ec│    timestamp: 2017-04-14 20:21:44 UTC                                │dcc703c0e500b653ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
ee82cae4a9c946ecb102db3aced                                         │    extraData: 0                                                      │{"updatedAccounts":{"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859":{"contra
    parentHash: 546522c7bc83cceb80047367b2ccd98ba5da3ba05e3444dca7f3│    nonce: 6                                                          │ctRoot":null,"balance":{"oldValue":180925139433306555349329664076074856
41213e648bdc                                                        │            (no transactions)                                         │0207343510400633558116257000123642650624,"newValue":1809251394333065553
    unclesHash: 1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a1│            (no uncles)                                               │493296640760748560207343510400633557116255950123642650624},"storage":{}
42fd40d49347 (the empty array)                                      │OutputBlock #238; total diff 1958652 (via Quarry) 5cea5024ae98a505db28│,"codeHash":"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d
    coinbase: ccda5fc564b61cca7f14b584b29f0d54fd2d599d              │8cd5ea1808843b4c57d7e58c3891be563093e5d6f0d1                          │85a470","code":null,"nonce":{"oldValue":255,"newValue":256}}}}
    stateRoot: 995f3b458747a2a949698c0cc58b5b0e4fab97038e3b3f02ef123│    parentHash: 6f427e265731c364c1fb1150827f051dd5dd8684244326a1b8a306│{"updatedAccounts":{"a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6":{"contra
8e79a6494f0                                                         │42aca3f01b                                                            │ctRoot":null,"balance":{"oldValue":2140139650000000000000,"newValue":21
    transactionsRoot: <empty>                                       │    unclesHash: 1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142│45139650000000000000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2
    receiptsRoot: <empty>                                           │fd40d49347 (the empty array)                                          │dcc703c0e500b653ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
    difficulty: 8196                                                │    coinbase: a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6                │{"updatedAccounts":{"00000000000000000123":{"contractRoot":null,"balanc
    gasLimit: 23277839875953090603424296717618                      │    stateRoot: 307bcab7f0920a3c5c9fb4a5c08e97a4541923d8452b4b54f2e9d4c│e":{"oldValue":256000000000000000000000,"newValue":25700000000000000000
    gasUsed: 0                                                      │618b8777a                                                             │0000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2dcc703c0e500b653
    timestamp: 2017-04-14 20:14:56 UTC                              │    transactionsRoot: <empty>                                         │ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
    extraData: 0                                                    │    receiptsRoot: <empty>                                             │{"updatedAccounts":{"ccda5fc564b61cca7f14b584b29f0d54fd2d599d":{"contra
    nonce: 6                                                        │    difficulty: 8196                                                  │ctRoot":null,"balance":{"oldValue":1885129150000000000000,"newValue":18
            (no transactions)                                       │    gasLimit: 28406652714000428885421648467140                        │90130200000000000000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2
            (no uncles)                                             │    gasUsed: 0                                                        │dcc703c0e500b653ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
Block #35 (via Peer f111167be3dc11351284b70ec8159af629ffe9168df9576a│    timestamp: 2017-04-14 20:21:44 UTC                                │{"updatedAccounts":{"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859":{"contra
64b230f7a694d6952acffb63d34a5a4f2a4f196199117881a79e170d42cd6700ee36│    extraData: 0                                                      │ctRoot":null,"balance":{"oldValue":180925139433306555349329664076074856
a7879541f6f2@172.20.0.7:36595) fd7689bda578b4b0ffaa979a17d23df4e1b5b│    nonce: 6                                                          │0207343510400633557116255950123642650624,"newValue":1809251394333065553
a70210dfff4a7c23a0a1cd6f813                                         │            (no transactions)                                         │493296640760748560207343510400633556116254900123642650624},"storage":{}
    parentHash: 86ab5e3f4c4276d51c181b28e3f848e07737693e7deea220729a│            (no uncles)                                               │,"codeHash":"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d
21ec15f5be5d                                                        │OutputBlock #239; total diff 1966844 (via Quarry) c761c1c7f3733f41a2ff│85a470","code":null,"nonce":{"oldValue":256,"newValue":257}}}}
    unclesHash: 1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a1│a6112cf1a58e8665ec4cd3fccc187949659c01efd7d9                          │{"updatedAccounts":{"ccda5fc564b61cca7f14b584b29f0d54fd2d599d":{"contra
42fd40d49347 (the empty array)                                      │    parentHash: 082fca6d01bc1930196bc015621a3a70356ed3feed851bc5ed9f6a│ctRoot":null,"balance":{"oldValue":1890130200000000000000,"newValue":18
    coinbase: ccda5fc564b61cca7f14b584b29f0d54fd2d599d              │8073fee6dc                                                            │95130200000000000000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2
    stateRoot: 533a8516fd0854d23de9acd03d527a07353e219608ac17b0ee8bd│    unclesHash: 1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142│dcc703c0e500b653ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
1a1a90b9919                                                         │fd40d49347 (the empty array)                                          │{"updatedAccounts":{"00000000000000000123":{"contractRoot":null,"balanc
    transactionsRoot: <empty>                                       │    coinbase: a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6                │e":{"oldValue":257000000000000000000000,"newValue":25800000000000000000
    receiptsRoot: <empty>                                           │    stateRoot: 9afd129988bc79b5dd2632de3ffc6321120975bf5ed0103351fe745│0000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2dcc703c0e500b653
    difficulty: 8200                                                │92ceed510                                                             │ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
    gasLimit: 23300572141456951043466703257381                      │    transactionsRoot: <empty>                                         │{"updatedAccounts":{"ccda5fc564b61cca7f14b584b29f0d54fd2d599d":{"contra
    gasUsed: 0                                                      │    receiptsRoot: <empty>                                             │ctRoot":null,"balance":{"oldValue":1895130200000000000000,"newValue":18
    timestamp: 2017-04-14 20:14:57 UTC                              │    difficulty: 8192                                                  │95131250000000000000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2
    extraData: 0                                                    │    gasLimit: 28434393585791444929255068045721                        │dcc703c0e500b653ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
    nonce: 6                                                        │    gasUsed: 0                                                        │{"updatedAccounts":{"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859":{"contra
            (no transactions)                                       │    timestamp: 2017-04-14 20:21:46 UTC                                │ctRoot":null,"balance":{"oldValue":180925139433306555349329664076074856
            (no uncles)                                             │    extraData: 0                                                      │85a470","code":null,"nonce":{"oldValue":256,"newValue":257}}}}
Block #34 (via Quarry) 86ab5e3f4c4276d51c181b28e3f848e07737693e7deea│    nonce: 6                                                          │{"updatedAccounts":{"ccda5fc564b61cca7f14b584b29f0d54fd2d599d":{"contra
220729a21ec15f5be5d                                                 │            (no transactions)                                         │ctRoot":null,"balance":{"oldValue":1890130200000000000000,"newValue":18
    parentHash: 546522c7bc83cceb80047367b2ccd98ba5da3ba05e3444dca7f3│            (no uncles)                                               │95130200000000000000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2
41213e648bdc                                                        │OutputBlock #239; total diff 1966844 (via Peer f111167be3dc11351284b70│dcc703c0e500b653ca82273b7bfad8045d85a470","code":null,"nonce":null}}}
    unclesHash: 1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a1│ec8159af629ffe9168df9576a64b230f7a694d6952acffb63d34a5a4f2a4f196199117│{"updatedAccounts":{"00000000000000000123":{"contractRoot":null,"balanc
42fd40d49347 (the empty array)                                      │881a79e170d42cd6700ee36a7879541f6f2@172.20.0.7:36595) bfc1a037f32fa3b5│e":{"oldValue":257000000000000000000000,"newValue":25800000000000000000
    coinba                                                          │ea7c89af6e99d2e038c6faf866ce83bcd838                                  │0000},"storage":{},"codeHash":"c5d2460186f7233c927e7db2dcc703c0e500b653
[s0] 0:host  1:backbone  2:indexers  3:network  4:strato-api  5:misc-api  6:explorer  7:graphs- 8:stream_blocks  9:stream_seq* 10:checkpoints  11:cirrus  12:monitor  13:d> "docker  /home/blockap" 17:22 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 17:22 17-Apr-17
```

## checkpoints

```
Every 1.0s: docker exec -it strato_strato_1 bash -c 'cd /var/lib/strato; queryStrato dumpredis'                                                                                            Mon Apr 17 17:23:22 2017

Best block number:      71218
Best block tot. diff:   583475092
Best block hash:        9fb601226282cc7e4f5799d842e71063f37a97cbb983a0268939012cf03d0cfe







───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Every 1.0s: docker exec -it strato_strato_1 bash -c 'cd /var/lib/strato; queryStrato checkpoints -s sequencer -o get'                                                                      Mon Apr 17 17:23:09 2017

Checkpoint for service: sequencer
Offset is Offset 395860






───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Every 1.0s: docker exec -it strato_strato_1 bash -c 'cd /var/lib/strato; queryStrato checkpoints -s evm -o get'                                                                            Mon Apr 17 17:23:21 2017

Checkpoint for service: evm
Offset is Offset 352371
Metadata is:
f90316a09fb601226282cc7e4f5799d842e71063f37a97cbb983a0268939012cf03d0cfef9014fa00fa03b58d8e80f80b183d3300d30b9a900eb75d848f721b0d0a1a663032fc2b5a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d493479
4a59fa4d8bb0f25330631dbf9d7d557b6c115f9d6a0244bf36fae46804011016f59595ba4f7d75cf10fadbaf1a721a89ca36c7abfbba0b96ba42fb34f05f6a5ee2ed81186ef692ff43a30c9c9c7d93c5780992b9da73aa056e81f171bcc55a6ff8345e692c0f86e5b48
e01b996cadc001622fb5e363b421b84030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030822000830116329a15b341a392b56db07b4430e0f57112528fa
c123115bf9fd822ea808458f4f9f280a00000000000000000000000000000000000000000000000000000000000000000880000000000000006e1a073be8da554e2a997edea29804bf444e835b8f5d392837a51ec1dfb397a28270df9017e01f9017aa09fb601226282
cc7e4f5799d842e71063f37a97cbb983a0268939012cf03d0cfef9014fa00fa03b58d8e80f80b183d3300d30b9a900eb75d848f721b0d0a1a663032fc2b5a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d4934794a59fa4d8bb0f2533063
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Every 1.0s: docker exec -it strato_strato_1 bash -c 'cd /var/lib/strato; queryStrato checkpoints -s apiindexer -o get'                                                                     Mon Apr 17 17:23:21 2017

Checkpoint for service: apiindexer
Offset is Offset 257574
Metadata is:
153951




───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Every 1.0s: docker exec -it strato_strato_1 bash -c 'cd /var/lib/strato; queryStrato checkpoints -s p2pindexer -o get'                                                                     Mon Apr 17 17:23:21 2017

Checkpoint for service: p2pindexer
Offset is Offset 257574









[s0] 0:host  1:backbone  2:indexers  3:network  4:strato-api  5:misc-api  6:explorer  7:graphs  8:stream_blocks  9:stream_seq- 10:checkpoints* 11:cirrus  12:monitor  13:d> "watch  /home/blockapp" 17:23 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 17:23 17-Apr-17
```

## monitor

```
                                                                                                       │                     19.1Mb               38.1Mb               57.2Mb               76.3Mb          95.4Mb
  1  [|||||||||||||||||||||||||||||||||||||99.3%]   Tasks: 386, 877 thr; 16 running                     │+--------------------+--------------------+--------------------+--------------------+---------------------
  2  [|||||||||||||||||||||||||||||||||||||97.4%]   Load average: 21.48 18.70 14.90                     │10.10.0.5                               => 107.14.57.128                           80.6Kb  68.4Kb  72.6Kb
  3  [|||||||||||||||||||||||||||||||||||||92.7%]   Uptime: 41 days, 23:13:09                           │                                        <=                                         3.66Kb  4.29Kb  4.32Kb
  4  [|||||||||||||||||||||||||||||||||||||96.7%]                                                       │10.10.0.5                               => 121.18.238.104                          1.14Kb  3.24Kb  2.82Kb
  Mem[|||||||||||||||||||||||||||||||12.4G/13.7G]                                                       │                                        <=                                          544b   1.63Kb  1.79Kb
  Swp[                                     0K/0K]                                                       │10.10.0.5                               => 221.194.47.208                           480b    605b   2.37Kb
                                                                                                        │                                        <=                                            0b    326b   1.44Kb
  PID USER      PRI  NI  VIRT   RES   SHR S CPU% MEM%   TIME+  Command                                  │10.10.0.5                               => 116.31.116.14                              0b    454b    637b
    1 root       20   0 38064  5368  3228 S  0.0  0.0  1:17.18 /lib/systemd/systemd --system --deseriali│                                        <=                                            0b    397b    457b
41288 blockapps  20   0 19556   320     0 S  0.0  0.0  0:42.87 ├─ tmux -CC a                            │10.10.0.5                               => 168.63.129.16                              0b    246b    383b
40981 blockapps  20   0  797M  780M  1528 R 36.5  5.6 50:46.93 ├─ tmux -CC                              │                                        <=                                            0b    493b   1.02Kb
65055 blockapps  20   0  247M  2512  1584 S  0.0  0.0  0:00.06 │  ├─ -fish                              │10.10.0.5                               => helium.constant.com                        0b     61b     15b
  976 root       20   0 57620  2048  1588 S  0.0  0.0  0:00.00 │  │  └─ sudo iftop                      │                                        <=                                            0b     61b     15b
 1015 root       20   0  243M  3660  1076 S  0.0  0.0  0:56.67 │  │     └─ iftop                        │10.10.0.5                               => table.bl5prdstr06a.store.core.windows.     0b      0b   1.88Kb
 1149 root       20   0  243M  3660  1076 S  0.0  0.0  0:08.58 │  │        ├─ iftop                     │                                        <=                                            0b      0b   3.41Kb
 1021 root       20   0  243M  3660  1076 S  0.0  0.0  0:00.01 │  │        ├─ iftop                     │10.10.0.5                               => 168.62.32.14                               0b      0b    356b
 1020 root       20   0  243M  3660  1076 S  0.0  0.0  0:00.02 │  │        └─ iftop                     │                                        <=                                            0b      0b   3.51Kb
64611 blockapps  20   0  247M  2608  1608 S  0.0  0.0  0:00.07 │  ├─ -fish                              │10.10.0.5                               => blob.bl5prdstr06a.store.core.windows.n     0b      0b    866b
  718 blockapps  20   0 13524  3072  1872 S  0.0  0.0  1:07.40 │  │  └─ watch -c -n 5 ./watcher.sh cirru│                                        <=                                            0b      0b   1.78Kb
63486 blockapps  20   0  119M  2500  1588 S  0.0  0.0  0:00.07 │  ├─ -fish                              │10.10.0.5                               => thedipsy.thedipsy.com                      0b      0b   1.11Kb
  322 blockapps  20   0 12944  2396  1816 S  0.0  0.0  1:07.36 │  │  └─ watch -c -n 5 ./watcher.sh cirru│                                        <=                                            0b      0b    776b
62778 blockapps  20   0  311M  2632  1644 S  0.0  0.0  0:00.10 │  ├─ -fish                              │10.10.0.5                               => 58.218.199.218                             0b      0b    692b
64309 blockapps  20   0 12948  2664  2048 S  0.0  0.0  1:05.04 │  │  └─ watch -n 1 docker exec -it strat│                                        <=                                            0b      0b    522b
 8927 blockapps  20   0 12948   616     0 S  0.0  0.0  0:00.00 │  │     └─ watch -n 1 docker exec -it st│
 8936 blockapps  20   0  4508   800   720 S  0.0  0.0  0:00.00 │  │        └─ sh -c docker exec -it stra│----------------------------------------------------------------------------------------------------------
 8961 blockapps  20   0  265M 13084  9432 S  0.0  0.1  0:00.00 │  │           └─ docker exec -it strato_│TX:             cum:   1.38GB   peak:    139Kb                            rates:   82.2Kb  73.0Kb  83.6Kb
 9017 blockapps  20   0  265M 13084  9432 S  0.0  0.1  0:00.00 │  │              ├─ docker exec -it stra│RX:                    1.15GB            135Kb                                     4.19Kb  7.17Kb  19.0Kb
F1Help  F2Setup F3SearchF4FilterF5SortedF6CollapF7Nice -F8Nice +F9Kill  F10Quit                         │TOTAL:                 2.53GB            244Kb                                     86.4Kb  80.1Kb   103Kb
────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────
          61.27    0.00   36.96    0.00    0.00    1.77                                                 │  ctop - 17:26:52 UTC      31 containers
                                                                                                        │
Device:            tps    kB_read/s    kB_wrtn/s    kB_read    kB_wrtn                                  │   NAME                CID                 CPU                 MEM                 NET RX/TX
loop0            62.00         0.00       348.00          0        348                                  │
loop1             0.00         0.00         0.00          0          0                                  │ ◉  ctop-strato_strato… 32a14c31f931                 1%             14M / 13.69G    648B / 0B
scd0              0.00         0.00         0.00          0          0                                  │ ◉  ctop-strato_strato… 9d6bdaa289b5                 2%             12M / 13.69G    648B / 0B
fd0               0.00         0.00         0.00          0          0                                  │ ◉  strato_kafka_1      111e666d648b                 1%            1.03G / 13.69G   28.7G / 34.32G
sda               2.00         0.00        40.00          0         40                                  │ ◉  strato_postgres_1   5afb351b65a7                 3%             1.1G / 13.69G   3.53G / 18.51G
sdb               0.00         0.00         0.00          0          0                                  │ ◉  strato_redis_1      07eea2230195                 0%             416M / 13.69G   26.15G / 44.00G
sdc              39.00         0.00       444.00          0        444                                  │ ◉  strato_strato-1_1   8a3038053305                235%           6.98G / 13.69G   57.82G / 27.39G
docker-8:33-44567741-pool    37.00         0.00       168.00          0        168                      │ ◉  strato_strato_1     d1afbf79ed79                192%            569M / 13.69G   64.66G / 56.78G
docker-8:33-44567741-1bb26cd066f92a88e560cbd3c74cff683a9b96167883675fcfb0ed5dc064d486     6.00         0│ ◉  strato_zookeeper_1  c389adc49624                 0%             116M / 13.69G   16M / 10M
.00        48.00          0         48                                                                  │ ◉  815379e56162_cirru… 815379e56162                  -                   -         -
docker-8:33-44567741-2b4aae0ce8819c499d8f759fdc41877cd1df04b95e3add6d04042d4a52674adb     0.00         0│ ◉  cirrus_cirrus_birr… df8752ab3a8a                  -                   -         -
.00         0.00          0          0                                                                  │ ◉  cirrus_cirrus_bloc… 0b9c650e325e                  -                   -         -
docker-8:33-44567741-851040208cc11e70586d52bbc15e014d7de4f5058e5a4f93c91067d273de50c4     0.00         0│ ◉  cirrus_cirrus_cirr… 9ba0aa34a197                  -                   -         -
.00         0.00          0          0                                                                  │ ◉  cirrus_cirrus_vm_1  d6a5741da9cb                  -                   -         -
docker-8:33-44567741-2ee95bb4588543d7af3989f2da0f5383ea8c7b4e6dea0a939abe4a5ca68d76cb    30.00         0│ ◉  ctop                dee50dcdc625                  -                   -         -
.00       120.00          0        120                                                                  │ ◉  loving_darwin       b7afa388e101                  -                   -         -
docker-8:33-44567741-9b92a651736b4e40988f540b3ee61ed9e431191aa2cb833312120c96684f577b     0.00         0│ ◉  serene_stonebraker  ea5009109bf1                  -                   -         -
.00         0.00          0          0                                                                  │ ◉  silo_dashboard_1    a6bf7ea469bd                  -                   -         -
docker-8:33-44567741-770c098104522ba6b949322f72ec8d8348b99fc1360a71b2c04dbda4b4f0946a     0.00         0│ ◉  silo_strato-2_1     706fdfbb5999                  -                   -         -
.00         0.00          0          0                                                                  │ ◉  silo_strato-duplic… 8e7944127824                  -                   -         -
docker-8:33-44567741-482b61ce66c35a99c8e13529e09f282a12ac5b3b07117d3efba23f4b098265b2     0.00         0│ ◉  silo_strato2_1      27ac468920d4                  -                   -         -
.00         0.00          0          0                                                                  │ ◉  some-docker         17d256b18750                  -                   -         -
docker-8:33-44567741-75f0bf64fcbe251d3291b21324ea5a9f50b41953f79ff1211e61879cb95575ae     0.00         0│ ◉  cirrus_cirrus_1     7e54217ca83c                  -                   -         -
.00         0.00          0          0                                                                  │ ◉  ctop-strato_strato… 3364c9759eea                  -                   -         -
                                                                                                        │ ◉  drunk_hamilton      fb124c4d9ae3                  -                   -         -
                                                                                                        │ ◉  fervent_goldwasser  0477427b2425                  -                   -         -
[s0] 0:host  1:backbone  2:indexers  3:network  4:strato-api  5:misc-api  6:explorer  7:graphs  8:stream_blocks  9:stream_seq  10:checkpoints  11:cirrus  12:monitor* 13:d> "docker  /home/blockap" 17:26 17-Apr-17
[18] 0:build- 1:tmux*                                                                                                                                                       "bash  /home/blockapps" 17:26 17-Apr-17
```
