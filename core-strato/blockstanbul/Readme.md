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
