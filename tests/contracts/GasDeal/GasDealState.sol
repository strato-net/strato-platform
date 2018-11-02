contract GasDealState {
    enum GasDealState {
        NULL,
        WAIT_COUNTER_PRICE,
        WAIT_MATCH,
        PRICE_EXCEPTION,
        EXCEPTION_WAIT_COUNTER_PRICE,
        EXCEPTION_WAIT_PRICE,
        WAIT_DISSAG,
        WAIT_VOLUME_MATCH,
        REPLACE,
        EXCEPTION_CUTS,
        WAIT_COUNTER_CUTS_APPROVAL,
        WAIT_COUNTER_RESUPPLY,
        WAIT_BOOKOUT,
        WAIT_ADJUSTMENT,
        HANDOFF,
        SETTLED,
        PAID,
        INACTIVE_REJECTED,
        MAX
    }
}
