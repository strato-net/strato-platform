contract record PowerDealState {
    enum PowerDealState {
        NULL,
        WAIT_COUNTER_PRICE,
        WAIT_MATCH,
        PRICE_EXCEPTION,
        EXCEPTION_WAIT_COUNTER_PRICE,
        EXCEPTION_WAIT_PRICE,
        REPLACE,
        EXCEPTION_CUTS,
        WAIT_COUNTER_CUTS_APPROVAL,
        WAIT_RESUPPLY,
        WAIT_BOOKOUT,
        WAIT_ADJUSTMENT,
        HANDOFF,
        TRADE_LOCK,
        SETTLED,
        PAID,
        MAX
    }
}
