Blockstanbul is an implementation of PBFT, guided more in implementation by
https://github.com/ethereum/EIPs/issues/650 than by the Castro-Liskov 99.

Architecture
------------
When the sequencer communicates with blockstanbul, it sends a list of InEvents
and receives a list of OutEvents.  The module is embedded within the sequencer,
and in its currently iteration operates as a zoomed state monad. However, the
sequencer does not inspect the BlockstanbulContext and so it could in theory be
run as a separate thread (or even a process responding with OutEvents to
InEvents over a network protocol). The design also adheres to the "functional
core, imperative shell" paradigm. The blockstanbul module doesn't interact with
disk, network, or time. It relies on the sequencer to propagate its will,
either by setting alarms, sending to the VM for commit, or sharing with peers
via strato-p2p, or adding a checkpoint to kafka. From my perspective, the
greatest win for this layout is the testability of the module, as setting off
an alarm for the round is as easy as inputting a `TimerFire <roundnumber>`.
For the same reasons, authorization was originally a field of the state
`:: InEvent -> Bool` to test without lining up all signatures, but eventually I
found that I only needed authorization on or off than to anticipate arbitrary
authorization. This should also make system tests easier, as a faulty node can
be implemented as a function `[InEvent] -> m [OutEvent]. As some sample
faulty behaviors from the folks at am.is: NotBroadcast, SendWrongMsg, ModifySig,
AlwaysPropose, AlwaysRoundChange, BadBlock

The main loop is implemented as a conduit that authorizes events and
then pattern matches on the constructor to determine how to handle it.
The code makes liberal uses of lenses to manipulate the state, and is essentially
written in an imperative style. The state transitions (e.g. from Prepared -> Committed)
are not represented explicitly, and a more fluid description of state is done
by just tracking the state of each validator. The nodes in the finite state
machine are then derived, by e.g. seeing if there is a blockhash that has
quorum in the `_committed` field. There are similar maps in `_prepared`,
`_roundChanged`, and `_voted` (`_voted` for administrative purposes, to
resize the validator pool).

Communication
-------------
The normal PBFT messages (PRE_PREPARE/PREPARE/COMMIT/ROUNDCHANGE) are exchanged
on the topics between the sequencer and p2p, and are broadcast to all peers.
The RLP instance for these should be the same as for the geth implementation of
Istanbul, but its possible that they have an extra layer of RLP by the time it
reaches ethcrypt. If integration becomes a concern, that may need to be fixed.
There are also some supplementary p2p controls (GapFound/LeadFound) that can be
used to bring a peer that's behind up to speed.

The protocol between the sequencer and the VM has a MakeBlockCommand for
PBFT to request a block when this node is the proposer, and the ToCommit
message to finalize a block with the VM. When it receives a PRE_PREPARE, the
sequencer will decide if it should vote for the block by sending a RunPreprepare
message to the VM. If the stateroot matches what is expected, the VM will respond
with a AcceptPreprepare message, triggering the sequencer to send out a PREPARE
to the other validators. On the other hand, if the VM sends back a RejectPreprepare,
then the ending states did not match (at which point the sequencer will send out a
ROUNDCHANGE to move along to the next proposer, who will hopefully provide a valid
block).

PBFT will set a timer with `ResetTimer RoundNumber` and then after the
round period should receive `RoundTimeout RoundNumber`

On state transitions, a `NewCheckpoint` will be emitted and for now
this is saved as kafka metadata.

Historic Blocks
---------------
When PBFT receives a block, the ones without signatures attached will be considered
for the next proposal if this node is the leader. When the block does have signatures
attached, it will be verified for continuity (the correct parent hash, block number)
and for authenticity (the validators on the block are the same as the ones in memory,
the proposer was a validator, and >2/3s of the validators had a commitment seal). 
If those checks all pass, the sequence number will be incremented and the block will
be sent to the VM to be included into the total state.
