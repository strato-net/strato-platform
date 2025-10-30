contract record EventLogType {
  // event log type
  enum EventLogType { // TODO expose -LS
    NULL,
    GRANT,
    REVOKE,
    CHECK
  }
}