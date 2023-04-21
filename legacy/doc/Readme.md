Basic Structure
-----------------
The strato platform is organized as a collection of microservices, each of
which is comprised of several processes. The boundaries of those services are
determined by docker containers.  docker-compose will create a virtual network
joining those containers together, so that e.g. `kafka:9092` will address port
9092 inside the kafka container. Some microservices also use volumes to persist
parts of the filesystem after the container is removed. The off-the-shelf
images that we use are

  * nginx: a web server
  * kafka: a message queue
  * zookeeper: only used here as a configuration store for kafka
  * postgres: a relational database
  * postgrest: an HTTP proxy for postgres
  * redis: an in-memory-key value store
  * swagger: an API documentation server
  * prometheus: a metrics aggregator and query engine

Communication between containers is done mostly through HTTP requests, although
some postgres tables and kafka topics are shared between containers.

Externally, the strato platform is an HTTP server on port 80 (or sometimes
HTTPS on 443), an ethereum p2p server on tcp port 30303 and an ethereum
discovery server on udp port 30303. 80/443 are routed to nginx, and 30303 are
routed directly to strato. When nginx receives an HTTP request, it will examine
the path to determine which container to forward the request to. If oauth is
enabled, authenticate the token on the inbound request and set headers to that
username on the outbound request.

Life of a transaction
---------------------
When a user wants to change the state of the blockchain, they must post a
transaction.  Transactions are typically initiated from the smd container (the
built-in UI), the swagger container (a documentation platform that allows
testing out requests), or from the clientside javascript library,
blockapps-rest. Transactions are then sent to Bloc. In the legacy user mode,
Bloc will sign transactions itself. When running with Oauth, the vault-wrapper
container is responsible for managing keys. For now, these both store keys in
postgres. Keys in bloc are encrypted with the users password, and keys in
vault-wrapper are encrypted by a global password for the node. Vault-wrapper
aspires to use a secure hardware enclave for key management. In any case,
signatures are secp256k1 using ECDSA.  If target VM is the EVM, Bloc will call
`solc` to determine the bytecode for a contract upload and encode arguments. If
the target is SolidVM, no encoding is necessary. Bloc will keep a record of
this upload in its postgres tables, to avoid recompilation and allow the
metadata to be usable by slipstream.

At a high level, bloch will post a transaction to the strato container and
eventually receive a TransactionResult (by polling strato-api). If a user
wants to see the effect of their transaction, they can request account details
of a user or the `state` of a contract to view the latest state, that proxy
to strato-api. Complementary state is available through slipstream. Slipstream
will index the results of transaction execution and create a table for each
contract name. The columns of those tables are metadata about the last
transaction/block/time that the contract was indexed, and the fields of
the contract. However, neither of these can index mappings and so
using the raw /storage api can be more useful in that case. For SolidVM,
bloch is able to decode mappings. (slipstream could as well, but they
are disabled for performance).

When querying cirrus, requests are sent to postgrest through `/cirrus/search/`.
Postgrest has a somewhat recognizable subset of SQL available through queryparams,
e.g. `/cirrus/search/Users?select=address&username=eq.tim@blockapps.net` will
return the addresses of all users that have the username "tim@blockapps.net"

In the background, prometheus has been collecting metrics from the containers.
Most of the instrumentation has been applied to strato and bloch processes, but there
are also client libraries for nodejs or nginx/lua, and integrations/exporters for
the JVM, redis, or postgres. These metrics can be used in chart generation at /prometheus
itself, collected as timing data, or (someday) used as a signal for alerting.

Life of a Transaction (Zoomed in)
---------------------------------
The strato container in someways operates like a collection of microservices
itself.  There is some redis based communication from the VM to P2P, and shared
tables as well in the eth_* database. Two global configuration files determine
connection parameters to other services, node identity, and topic names
(/var/lib/strato/.ethereumH/{ethconf.yaml,topics.yaml}).  Almost always
however, interprocess communication within the container is mediated by kafka.
Sending a message appends it to a topic, and messages are received by checking
a topic for new messages. This is handled efficiently by sleeping on a file
descriptor, but this can sometimes be a gotcha when other inputs to the thread
(e.g. HTTP requests or timer fires) are delayed by up to 100s. Another aspect
of kafka usage is to checkpoint state of a process, so that on restart it would
be able to pick up where it left off. The two aspects to the checkpoint are the
offset (which event to start from) and the metadata (a string used to store
some process state). The api-indexer stores the best block number as its
metadata, the sequencer stores a bit larger metadata with the last PBFT state,
and the VM stores even entire blocks in its checkpoint.

doit.sh is at the top level of the process tree, and forks off each executable
for the container.  It then continually polls for liveness, and kills all
processes once one child dies. This can make it tricky to restart a process in
a running container without stopping all others, which is why they all have a
SIGHUP handler installed (in 4.5+) that will cause them to reexec themselves,
to swap out the binary without changing the process number.

Newly minted transactions arrive at strato-api. The one exception is faucets, which
are signed by the strato-api itself. They are output to `unseqevents`, as the input stream for
strato-sequencer. The API is an essentially stateless HTTP server.

The sequencer is a stateful process that can be summarized as holding store for
transactions and blocks until the VM can process them. In the case of
transactions, the sequencer will filter duplicates and then forward to p2p and
the vm. When transactions belong to a private chain, there is an additional
PrivateHashTX version of that transaction, that only provides the transaction
hash and a clue about which chain it belongs to. The full transaction won't be
shared with the VM until it is included in a block, and p2p will withhold the
full transaction from a peer unless it knows that the peer is a member of that
chain.

The vm-runner is also a stateful process that holds an event loop on the output
from the sequencer (via seq\_vm\_events).  The main datastructures of the
EthereumVM, the merkle patricia tries, are kept by vm-runner as in-memory maps
flushed to a leveldb backing store.  The VM will gather transactions (public
full and private hash) into bagger, which will prioritize and reject
transactions based off of gas prices and nonces. When bagger needs to build a block,
it will break of a chunk of its mempool and run the VM over all transactions in the chunk
to determine the state transition. Based on the VM-specified by the transaction, it
will either be executed by EVM or SolidVM. These VMs share merkle patricia tries,
so that a user account will have enough gas to execute on either. However, cross
VM calls are not supported at present and it will likely never be possible to call
into SolidVM from the EVM (but perhaps the reverse). The execution of a transaction
will proceed from one state root to another, and the output of the previous is
the input of the next.

After assembling the block, its sent to strato-adit (via unminedblocks). The
default consensus algorithm is PBFT, and adit passes the block along unchanged.
If instead proof-of-work is enabled, adit will search for a nonce to twiddle
the blockhash until its within an acceptable range. When adit is finished with
a block, its written to unseqevents towards the strato-sequencer.

The sequencer will check if it has processed the parent of this block, and if
not enqueue it until that parent arrives. Since this is a new block it won't
have any pending children, but if there were any they would be released from
the DependentBlockDB right after this one.

When the sequencer receives a new block in proof-of-work, it will broadcast it
to all peers as it has finished consensus itself in mining. Otherwise, it will
begin the consensus round for PBFT on the block. When this node is the leader,
the block will be signed and wrapped in a Preprepare to be broadcast. Peers
that acknowledge receipt of this proposal and that can confirm its basic
validity will broadcast a Prepare with the hash of the proposal. When a quorum
(2/3s of the validator pool) of Prepares has been received for this hash, a
Commit with a seal is broadcast. When quorum of Commits have been received, the
seals from those Commits are applied to the block and it moves to the hydration
phase of the sequencer. In addition to the commit seals, the PBFT metadata on a
block will include a list of validators and the proposer seal. Nodes that
missed consensus can then verify that those seals are all valid and correspond
to validators, and use that as a proof that consensus was reached. Note that
the commit seals on a block have no global order, so the blockHash ignores that
part of the metadata to reach a consistent hash.

The third phase of the sequencer is hydration. For PrivateHashTXs in the block,
they are resolved to an executable transaction if the chain is known to this
sequencer. The PrivateHashTXs are replaced with the full transaction
and the block is emitted to the VM. The logic is more complex and less well
understood by this author off the happy path, e.g. what happens when a
block arrives before this node is a member or whether this will hold up later
blocks if they are waiting for a private hash tx that will never arrive.

When the finalized block arrives at the VM, it checks to see that it has cached
execution results for that exact chain of transactions. Otherwise it will execute
the transactions in the same manner as block construction, with the exception that
it may adjust the best block as the current state-of-the-world and that results of
the transaction executions are added to the statediff topic for slipstream to index
them and written to the mirrors in postgres.
