# strato-barometer

This package contains tools to query the STRATO databases.


## Usage
```
// Send a JSON-formatted block to the node
strato-barometer addblocksfromfile --file-name=<block_file>

// Send multiple JSON-formatted transactions directly to node
strato-barometer addtxsfromfile --file-name=<transactions_file>    

// Send a JSON-formatted transaction directly to the node from a file
strato-barometer addtx --tx=<transaction_file>             

// Pass a range of block numbers to request from the network
// Can specify the nodes to request from using --org, --orgUnit, --commonName
strato-barometer askforblocks \  
    --start-block=<block_number> \
    --end-block=<block_number> \
    --org=<default: ""> \
    --orgUnit=<default: ""> \
    --commonName=<default: "">

// Send out range of blocks to network
// Can specify specific nodes to send to using --org, --orgUnit, --commonName 
strato-barometer pushblocks \
    --start-block=<block_number> \
    --end-block=<block_number> \
    --org=<default: ""> \
    --orgUnit=<default: ""> \
    --commonName=<default: "">

// Sends out a P2P message to the network to request for transactions
strato-barometer askfortxs

// Request data from desired Kafka checkpoint for specific topic
strato-barometer checkpoints \
    -s|--server <kafka_topic>
    -o|--op (get|put)
    -i|--offset <offset>
    -m|--metadata <data>

// Retrieve source code for given code hash
strato-barometer code <code_hash>

// Dumps the data being passed through the respective Kafka channels
strato-barometer dumpkafkablocks <offset>
strato-barometer dumpkafkavmevents <offset>    
strato-barometer dumpkafkasequencer <offset>  
strato-barometer dumpkafkasequencervm <offset> 
strato-barometer dumpkafkasequencerp2p <offset>
strato-barometer dumpkafkastatediff <offset>
strato-barometer dumpkafkaunsequencer <offset>
strato-barometer dumpredis <offset>

// Dumps raw Kafka data at specific topic and offset
strato-barometer dumpkafkaraw <topic_name> <offset> 

// Returns formatted raw RLP values for given Merkle-Patricia tree
strato-barometer frawmp (blocksummarycachedb|code|hash|hdash|sqeuencer_dependent_blocks|state) <key_value>

// Returns Merkle-Patricia tree values at given hash
strato-barometer hash <hash>       

// Returns raw RLP values for given Merkle-Patricia tree
strato-barometer rawmp (blocksummarycachedb|code|hash|hdash|sqeuencer_dependent_blocks|state) <key_value>

// Returns raw Merkle-Patricia tree for given LDB directory
strato-barometer raw (blocksummarycachedb|code|hash|hdash|sqeuencer_dependent_blocks|state)

// Retrieve the value by passing a key into the Redis store
// ex. strato-barometer redis bh:1234567890
strato-barometer redis <key_value>

// Retrieve a set of values by passing a regex into the Redis store
// ex. strato-barometer redismatch bh:*
strato-barometer redismatch <key_regex>      

// Returns raw RLP values for entire LDB directory
strato-barometer rlp (blocksummarycachedb|code|hash|hdash|sqeuencer_dependent_blocks|state)                

// Migrate database tables
strato-barometer migrate (data|global|peer|all)            

// Retrieve the AddressState's of a given state root
strato-barometer state <stateroot>

// (De-)activate the validator behavior of the node
strato-barometer validatorbehavior (true|false)

// Delete a dependent block from the node
strato-barometer deletedepblock <block_hash>

// Save Kafka data to file
strato-barometer savekafka --topic=<topic> --filename=<output_file>

// Load Kafka data 
strato-barometer loadkafka --topic=<topic> --filename=<input_file>

// Verify that given Kafka file is valid
strato-barometer verifykafkafile --filename=<file>

// Set the participation mode of the node's PBFT services
strato-barometer setparticipationmode (Full|None|NoConsensus)

```

## Ordered block recording

With a synced node running, export its canonical blocks from genesis through
the indexed tip:

```
strato-barometer exportblocks /absolute/path/upquark.blocks
strato-barometer verifyblocks /absolute/path/upquark.blocks
```

Use `--end-block=NUMBER` to record a fixed prefix. Export checks canonical hashes,
consecutive block numbers and parent links, and publishes the file only after
completion. It refuses to overwrite an existing file. Verification reads the
file without querying Redis and checks numbering, parent links, RLP round trips,
truncation and trailing data. These checks establish stream integrity; they do
not execute transactions or validate consensus signatures.

The binary format is `STRATO-BLOCKS-1\n`, followed by the final block number as
an unsigned 64-bit big-endian integer. Blocks 0 through that number follow, each
as an unsigned 64-bit big-endian byte length and the complete block's wire RLP
`[header, transactions, uncles]`. Readers can process one block at a time.
This is distinct from the JSON format accepted by `addblocksfromfile`.

To start a fresh node using the recording:

```
strato-up mynode --network=upquark --syncFromFile=/absolute/path/upquark.blocks
```

`--syncFromFile` is a `strato-setup` option, forwarded by `strato-up`. Setup
links the recording as `mynode/replay.blocks`; keep the recording outside the
node directory so deleting the node preserves it. P2P validates its genesis,
numbering, parent links and encoding, and sends blocks through normal sequencer
ingestion in batches. Already sequenced blocks are skipped on subsequent starts.
After the recorded tip is sequenced, P2P starts its normal peer connections.
Without `replay.blocks`, startup is unchanged. An unreadable or malformed
recording causes startup to fail.
