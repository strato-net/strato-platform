{-# LANGUAGE OverloadedStrings #-}

-- | Centralized fork-block constants for STRATO consensus-affecting changes.
--
-- Each fork is a tuple of (network ID, fork block number). Outside the named
-- network, the new behavior is enabled from genesis. Inside the named network,
-- old behavior holds for blocks strictly less than the fork block; new behavior
-- takes effect at and after.
--
-- Helium's staking forks share a single height (see heliumStakingForkBlock):
-- they ship in one binary, so they cannot be rolled back independently, and
-- their failure modes are already distinct (StakeMismatch vs
-- ReceiptsRootMismatch). One flag day is easier to run than two.
--
-- Existing inline fork constants in the SolidVM tree (heliumPassByRefForkBlock,
-- heliumToBasicForkBlock) predate this module and continue to live alongside
-- their use sites. New consensus forks should be added here so they're easy to
-- find and audit.
module Blockchain.Forks
  ( isReceiptsRootForkActive,
    isBlockRewardReceiptForkActive,
    isFeeConsensusDeltaForkActive,
    isConsensusFromStateForkActive,
    heliumConsensusFromStateForkBlock,
    isEmitArgForkActive,
    isOperatorPrecedenceForkActive,
    isRlpEncodeForkActive,
    isReplayProtectionForkActive,
    replayProtectionForkBlock,
    isStratoGasForkActive,
    constructorPublicationForkBlock,
    isConstructorPublicationForkActive,
    caughtFailureForkBlock,
    isCaughtFailureForkActive,
    argReferenceForkBlock,
    isArgReferenceForkActive,
    codelessImportForkBlock,
    isCodelessImportForkActive,
    forkNotScheduled,
    heliumNetworkID,
    upquarkNetworkID
  )
where

import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.EthConf.Model (networkConfig)

heliumNetworkID :: Integer
heliumNetworkID = 114784819836269

upquarkNetworkID :: Integer
upquarkNetworkID = 33056204878082667

-- | Throwaway network for rehearsing the staking/receipts-root flag day before
-- it runs on a live chain. Its forks sit at a low height on purpose: the point
-- is to exercise the legacy paths, the transition, and the post-fork paths in
-- one short-lived chain. Unlike helium and upquark, this network is created
-- after the fork code exists, so without an entry here it would run the new
-- rules from genesis and never test the old ones at all.
forktestNetworkID :: Integer
forktestNetworkID = 7381244120123405172

forktestForkBlock :: Integer
forktestForkBlock = 10000

-- | Upquark's flag day for its receipts-root and emit-arg forks (the
-- block-reward receipt fork stays with staking at upquarkStakingForkBlock).
-- Keep it equal to stratoGasForkBlock "upquark" in strato-conf.
upquarkForkBlock :: Integer
upquarkForkBlock = 1000000

heliumReceiptsRootForkBlock :: Integer
heliumReceiptsRootForkBlock = 250000

isReceiptsRootForkActive :: Integer -> Bool
isReceiptsRootForkActive blockNum =
  let net = Conf.networkID $ networkConfig ethConf
   in not $ (net == upquarkNetworkID  && blockNum < upquarkForkBlock)
         || (net == heliumNetworkID   && blockNum < heliumReceiptsRootForkBlock)
         || (net == forktestNetworkID && blockNum < forktestForkBlock)

-- | Block from which the block-reward call's events are folded into the block's
-- first receipt, so BlockRewardsPaid is visible to receipts and the indexer.
--
-- It needs a height because receipts roots are live in the header: adding a log
-- moves the root, so proposer and verifier have to start doing it at the same
-- block. Helium has already produced reward-paying blocks whose receipts omit
-- the event, so it gets its own switch height. Every other network switches when
-- staking activates — which is before it can ever pay a block reward, so no
-- network but helium has a window to reconcile.
--
-- Shared with the stake-event switch (stakingEventsFromGovernanceBlock in
-- strato-conf); keep the two in step.
heliumStakingForkBlock :: Integer
heliumStakingForkBlock = 300000

upquarkStakingForkBlock :: Integer
upquarkStakingForkBlock = 1010000

isBlockRewardReceiptForkActive :: Integer -> Bool
isBlockRewardReceiptForkActive blockNum =
  let conf = networkConfig ethConf
      switchAt
        | Conf.networkID conf == upquarkNetworkID = upquarkStakingForkBlock
        | Conf.networkID conf == heliumNetworkID = heliumStakingForkBlock
        -- 'Nothing' means staking is live from genesis, so the fork is too.
        | otherwise = maybe 0 id (Conf.stakingActivationBlock conf)
   in blockNum >= switchAt

-- | Block from which validator-set and stake changes published while paying a
-- transaction's fee, or by the block-reward call, reach the block header.
--
-- The fee payment runs as its own call ahead of the transaction, and only its
-- events, logs and action were folded into the transaction's results. Its
-- ValidatorAdded / ValidatorRemoved / ValidatorStakeUpdated deltas were dropped,
-- so governance changed while the header, and with it the consensus layer,
-- never heard of it. The block-reward call's results were folded into the
-- block's first transaction the same way.
--
-- Proposer and verifier both derive the header's deltas from those results, so
-- they have to start carrying these calls' at the same block. Upquark switches
-- with staking, the flag day it already has.
--
-- Helium switches where it starts reading the set and weights from state
-- (heliumConsensusFromStateForkBlock): the first block every validator can
-- apply a new rule at. The height here was 1,000,000, but helium passed that
-- block on builds without this rule and has sealed blocks without it since.
-- Block 1,000,587 jailed and removed a validator while paying a fee, and its
-- header carries no removal, so a node holding the rule from 1,000,000 cannot
-- verify it. From the state read on, the header's changes no longer come from
-- events, and this rule has nothing left to decide on helium.
heliumFeeConsensusDeltaForkBlock :: Integer
heliumFeeConsensusDeltaForkBlock = heliumConsensusFromStateForkBlock

forktestFeeConsensusDeltaForkBlock :: Integer
forktestFeeConsensusDeltaForkBlock = forkNotScheduled

isFeeConsensusDeltaForkActive :: Integer -> Bool
isFeeConsensusDeltaForkActive blockNum =
  let net = Conf.networkID $ networkConfig ethConf
   in not $ (net == upquarkNetworkID  && blockNum < upquarkStakingForkBlock)
         || (net == heliumNetworkID   && blockNum < heliumFeeConsensusDeltaForkBlock)
         || (net == forktestNetworkID && blockNum < forktestFeeConsensusDeltaForkBlock)

-- | Block from which the validator-set and stake-weight changes a block carries
-- in its header are read from contract state, not added up from events.
--
-- The header's newValidators, removedValidators and stakeUpdates were derived
-- from the ValidatorAdded, ValidatorRemoved and ValidatorStakeUpdated events of
-- the block's transactions. Events are not state: a call that reverts and is
-- caught by its caller has its storage rolled back, and on builds without the
-- try/catch fix it kept its events, so a rolled-back call could add a validator
-- or publish a weight that governance does not hold. Events of calls that run
-- outside a transaction's own results (the fee payment, the block-reward call)
-- needed a fork of their own to be counted at all.
--
-- From this block both proposer and verifier read the list of validators and
-- each one's weight from MercataGovernance's storage as the block leaves it,
-- and put the difference from the set and weights in force into the same
-- header fields. The header format and the consensus layer do not change.
--
-- Proposer and verifier must switch at the same block. Helium has blocks
-- sealed under the event rule and needs a height of its own; upquark switches
-- with staking, the flag day it already has.
--
-- Helium's height is a placeholder: the flag day helium already has ahead of
-- it (heliumRlpEncodeForkBlock), so validators upgrade once for both, and the
-- same height as the proportional proposer pick
-- (heliumProportionalSelectionBlock in strato-model, which this must equal).
-- Move all three together if the flag day moves.
heliumConsensusFromStateForkBlock :: Integer
heliumConsensusFromStateForkBlock = 1200000

-- A placeholder for the rehearsal network: just past its idle tip, and the same
-- height as forktestProportionalSelectionBlock in strato-model.
forktestConsensusFromStateForkBlock :: Integer
forktestConsensusFromStateForkBlock = 1500

isConsensusFromStateForkActive :: Integer -> Bool
isConsensusFromStateForkActive blockNum =
  let net = Conf.networkID $ networkConfig ethConf
   in not $ (net == upquarkNetworkID  && blockNum < upquarkStakingForkBlock)
         || (net == heliumNetworkID   && blockNum < heliumConsensusFromStateForkBlock)
         || (net == forktestNetworkID && blockNum < forktestConsensusFromStateForkBlock)

-- | Block from which SolidVM emits fully evaluated event args, with an arg that
-- was never written replaced by its declared type's default.
--
-- Before it, an emit kept each arg as read: storage references unresolved and
-- unwritten args as SReference/SNULL. Those have no TypedArg, so the receipt
-- log left them out; afterwards they are real values and appear in it. That
-- moves the receipts root, so the change needs a height on any network that
-- already checks receipts roots. Upquark switches with its receipts-root fork.
heliumEmitArgForkBlock :: Integer
heliumEmitArgForkBlock = 750000

isEmitArgForkActive :: Integer -> Bool
isEmitArgForkActive blockNum =
  let net = Conf.networkID $ networkConfig ethConf
   in not $ (net == upquarkNetworkID  && blockNum < upquarkForkBlock)
         || (net == heliumNetworkID   && blockNum < heliumEmitArgForkBlock)
         || (net == forktestNetworkID && blockNum < forktestForkBlock)

-- | Sentinel height for a fork that a live network has not scheduled yet: the
-- old behaviour holds for every block a node will actually see. Replace it with
-- the agreed flag-day height when the upgrade is coordinated.
forkNotScheduled :: Integer
forkNotScheduled = 2 ^ (62 :: Int)

-- | Block from which the SolidVM parser uses Solidity's operator precedence.
--
-- Before it, the expression parser ranked assignment above @&&@ and @||@ and
-- the ternary above all three, so an assignment statement whose right-hand side
-- was @X || Y@ or @X && Y@ parsed as @(a = X) || Y@ and stored only @X@
-- (@flag = flag || cond@ never set @flag@), and @a || b ? x : y@ parsed as
-- @a || (b ? x : y)@. It also ranked equality above the relational operators
-- and made @**@ and assignment left-associative.
--
-- Parsing is consensus-visible: the same deployed source must produce the same
-- AST on every node at every height, so this needs a fork height on any network
-- that already has blocks. The code-collection cache is keyed by the flag.
heliumOperatorPrecedenceForkBlock :: Integer
heliumOperatorPrecedenceForkBlock = forkNotScheduled

upquarkOperatorPrecedenceForkBlock :: Integer
upquarkOperatorPrecedenceForkBlock = forkNotScheduled

forktestOperatorPrecedenceForkBlock :: Integer
forktestOperatorPrecedenceForkBlock = forkNotScheduled

isOperatorPrecedenceForkActive :: Integer -> Bool
isOperatorPrecedenceForkActive blockNum =
  let net = Conf.networkID $ networkConfig ethConf
   in not $ (net == upquarkNetworkID  && blockNum < upquarkOperatorPrecedenceForkBlock)
         || (net == heliumNetworkID   && blockNum < heliumOperatorPrecedenceForkBlock)
         || (net == forktestNetworkID && blockNum < forktestOperatorPrecedenceForkBlock)

-- | Block from which SolidVM's RLP encoding of values gives every value its
-- own encoding.
--
-- Before it, contracts, mappings, user-defined values, function references and
-- the other non-data values all encoded as an empty list, so e.g. two different
-- contracts passed to keccak256 hashed the same. The encoding feeds keccak256,
-- sha256 and ripemd160 of non-bytes arguments and salted contract addresses, so
-- it is consensus-visible through the state root.
heliumRlpEncodeForkBlock :: Integer
heliumRlpEncodeForkBlock = 1200000

upquarkRlpEncodeForkBlock :: Integer
upquarkRlpEncodeForkBlock = 1000000

isRlpEncodeForkActive :: Integer -> Bool
isRlpEncodeForkActive blockNum =
  let net = Conf.networkID $ networkConfig ethConf
   in not $ (net == upquarkNetworkID  && blockNum < upquarkRlpEncodeForkBlock)
         || (net == heliumNetworkID   && blockNum < heliumRlpEncodeForkBlock)
         || (net == forktestNetworkID && blockNum < forktestForkBlock)

-- | Require signed chain binding from this height.
replayProtectionForkBlock :: Integer -> Integer
replayProtectionForkBlock net
  | net == heliumNetworkID = 1217000
  | net == upquarkNetworkID = 1010000
  | net == forktestNetworkID = forktestForkBlock
  | otherwise = 0

isReplayProtectionForkActive :: Integer -> Bool
isReplayProtectionForkActive blockNum =
  blockNum >= replayProtectionForkBlock (Conf.networkID $ networkConfig ethConf)

-- | Atomic caught failures change storage, events, sender restoration and
-- destruction effects. Upquark block 355722 committed an approval made by a
-- successful call inside a try block whose later call failed. Replaying it
-- with atomic rollback changes the state root. Keep the complete historical
-- behavior until each network coordinates activation; never choose a height
-- solely to get past the first failing block.
caughtFailureForkBlock :: Integer -> Integer
caughtFailureForkBlock net
  | net == heliumNetworkID = 1217000
  | net == upquarkNetworkID = 1010000
  | net == forktestNetworkID = forktestForkBlock
  | otherwise = 0

isCaughtFailureForkActive :: Integer -> Bool
isCaughtFailureForkActive blockNum =
  blockNum >= caughtFailureForkBlock (Conf.networkID $ networkConfig ethConf)

-- | A storage reference handed to another contract is read from the caller's
-- storage at the call. References nested in a variadic argument, and
-- value-typed references passed to a delegatecall, used to reach the callee
-- unresolved and were then read from the callee's storage: a caller could name
-- any slot of a proxied contract as an argument.
argReferenceForkBlock :: Integer -> Integer
argReferenceForkBlock net
  | net == heliumNetworkID = 1217000
  | net == upquarkNetworkID = 1010000
  | net == forktestNetworkID = forktestForkBlock
  | otherwise = 0

isArgReferenceForkActive :: Integer -> Bool
isArgReferenceForkActive blockNum =
  blockNum >= argReferenceForkBlock (Conf.networkID $ networkConfig ethConf)

-- | A creation whose source imports an address without SolidVM code fails.
-- Such an import used to be dropped, and resolved once code was deployed at
-- the address: the importing contract then changed behaviour on whichever
-- nodes recompiled it. From the same height a cached compile is reused only
-- while its imported addresses hold what they held when it was compiled, so
-- every node runs the same code whatever its cache history.
codelessImportForkBlock :: Integer -> Integer
codelessImportForkBlock net
  | net == heliumNetworkID = 1217000
  | net == upquarkNetworkID = 1010000
  | net == forktestNetworkID = forktestForkBlock
  | otherwise = 0

isCodelessImportForkActive :: Integer -> Bool
isCodelessImportForkActive blockNum =
  blockNum >= codelessImportForkBlock (Conf.networkID $ networkConfig ethConf)

-- | Publish SolidVM runtime code only after construction succeeds.
constructorPublicationForkBlock :: Integer -> Integer
constructorPublicationForkBlock net
  | net == heliumNetworkID = 76752
  | net == upquarkNetworkID = 65607
  | net == forktestNetworkID = forktestForkBlock
  | otherwise = 0

isConstructorPublicationForkActive :: Integer -> Bool
isConstructorPublicationForkActive blockNum =
  blockNum >= constructorPublicationForkBlock (Conf.networkID $ networkConfig ethConf)

-- | STRATO is the native currency from this block, and a native-value
-- transfer must arrive in a type-2 envelope (see envelopeRejection in
-- Blockchain.Bagger.Transactions). The height lives in strato-conf
-- (stratoGasForkBlock) because the RPC resolves the native token from it too.
isStratoGasForkActive :: Integer -> Bool
isStratoGasForkActive blockNum =
  blockNum >= Conf.stratoGasForkBlock (Conf.network $ networkConfig ethConf)
