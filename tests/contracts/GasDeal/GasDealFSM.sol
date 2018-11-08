import "./FSM.sol";
import "./GasDealState.sol";
import "./GasDealEvent.sol";
contract GasDealFSM is FSM, GasDealState, GasDealEvent {
    constructor() {
        // WAIT_COUNTER_PRICE
        addTransition(GasDealState.WAIT_COUNTER_PRICE, GasDealEvent.COUNTER_PARTY_PRICE, GasDealState.WAIT_MATCH);
        addTransition(GasDealState.WAIT_COUNTER_PRICE, GasDealEvent.DEAL_REJECTED, GasDealState.INACTIVE_REJECTED);
        // WAIT_MATCH
        addTransition(GasDealState.WAIT_MATCH, GasDealEvent.PRICE_MATCH, GasDealState.WAIT_DISSAG);
        addTransition(GasDealState.WAIT_MATCH, GasDealEvent.PRICE_MISMATCH, GasDealState.PRICE_EXCEPTION);
        // PRICE_EXCEPTION
        addTransition(GasDealState.PRICE_EXCEPTION, GasDealEvent.TRADER_PRICE, GasDealState.EXCEPTION_WAIT_COUNTER_PRICE);
        addTransition(GasDealState.PRICE_EXCEPTION, GasDealEvent.COUNTER_PARTY_PRICE, GasDealState.EXCEPTION_WAIT_PRICE);
        // EXCEPTION_WAIT_COUNTER_PRICE
        addTransition(GasDealState.EXCEPTION_WAIT_COUNTER_PRICE, GasDealEvent.COUNTER_PARTY_PRICE, GasDealState.WAIT_MATCH);
        // EXCEPTION_WAIT_PRICE
        addTransition(GasDealState.EXCEPTION_WAIT_PRICE, GasDealEvent.TRADER_PRICE, GasDealState.WAIT_MATCH);
        // WAIT_DISSAG
        addTransition(GasDealState.WAIT_DISSAG, GasDealEvent.DISSAG_MATCH, GasDealState.WAIT_VOLUME_MATCH);
        addTransition(GasDealState.WAIT_DISSAG, GasDealEvent.DISSAG_MISMATCH, GasDealState.EXCEPTION_CUTS);
        // WAIT_VOLUME_MATCH
        addTransition(GasDealState.WAIT_VOLUME_MATCH, GasDealEvent.VOLUME_MATCH, GasDealState.HANDOFF);
        addTransition(GasDealState.WAIT_VOLUME_MATCH, GasDealEvent.VOLUME_MISMATCH, GasDealState.EXCEPTION_CUTS);
        // EXCEPTION_CUTS
        // -- CUTS APPROVAL
        addTransition(GasDealState.EXCEPTION_CUTS, GasDealEvent.TRADER_CUTS_APPROVAL, GasDealState.WAIT_COUNTER_CUTS_APPROVAL);
        addTransition(GasDealState.WAIT_COUNTER_CUTS_APPROVAL, GasDealEvent.COUNTER_CUTS_APPROVAL, GasDealState.HANDOFF);
        addTransition(GasDealState.WAIT_COUNTER_CUTS_APPROVAL, GasDealEvent.COUNTER_CUTS_APPROVAL_REJECTED, GasDealState.HANDOFF);
        // -- RESUPPLY (Physical)
        addTransition(GasDealState.EXCEPTION_CUTS, GasDealEvent.TRADER_CUTS_RESUPPLY, GasDealState.WAIT_COUNTER_RESUPPLY);
        addTransition(GasDealState.WAIT_COUNTER_RESUPPLY, GasDealEvent.COUNTER_CUTS_RESUPPLY, GasDealState.HANDOFF);
        addTransition(GasDealState.WAIT_COUNTER_RESUPPLY, GasDealEvent.COUNTER_CUTS_RESUPPLY_REJECTED, GasDealState.HANDOFF);
        // -- BOOKOUT (Financial)
        addTransition(GasDealState.EXCEPTION_CUTS, GasDealEvent.EXCEPTION_CUTS_BOOKOUT, GasDealState.WAIT_BOOKOUT);
        addTransition(GasDealState.WAIT_BOOKOUT, GasDealEvent.BOOKOUT_COMPLETED, GasDealState.HANDOFF);
        // -- PRICE ADJUSTMENT
        addTransition(GasDealState.EXCEPTION_CUTS, GasDealEvent.EXCEPTION_CUTS_ADJUSTMENT, GasDealState.WAIT_ADJUSTMENT);
        addTransition(GasDealState.WAIT_ADJUSTMENT, GasDealEvent.ADJUSTMENT_COMPLETED, GasDealState.HANDOFF);
        // HANDOFF
        addTransition(GasDealState.HANDOFF, GasDealEvent.SETTLEMENT, GasDealState.SETTLED);
        // SETTLED
        addTransition(GasDealState.SETTLED, GasDealEvent.PAID_OUT, GasDealState.PAID);
    }
    function handleEvent(GasDealState _state, GasDealEvent _event) returns (GasDealState){
        return GasDealState(super.handleEvent(uint(_state), uint(_event)));
    }
    function addTransition(GasDealState _state, GasDealEvent _event, GasDealState _newState) {
      super.addTransition(uint(_state), uint(_event), uint(_newState));
    }
}
