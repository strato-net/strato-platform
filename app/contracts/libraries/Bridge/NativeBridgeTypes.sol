library NativeBridgeTypes {
    // APPEND ONLY. Native refund and cancellation statuses were deployed
    // before the solver's ANNOUNCED state.
    enum NativeBridgeStatus {
        NONE,
        INITIATED,
        PENDING_REVIEW,
        COMPLETED,
        ABORTED,
        SWEPT,
        QUARANTINED,
        REFUND_PENDING,
        REFUNDED,
        REJECTED_NO_FUNDS,
        CANCELLATION_PENDING,
        ANNOUNCED
    }
}
