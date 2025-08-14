/*  ────────────────────────────────────────────────────────────────────────
    ReentrancyGuard
    -----------------------------------------------------------------------
    Simple mutex that prevents a function from being re-entered by the same
    or another call stack in the *same* transaction.

    Usage:
      contract Foo is ReentrancyGuard {
          function bar() external nonReentrant {
              ...
          }
      }
    ─────────────────────────────────────────────────────────────────────── */
abstract contract ReentrancyGuard {
    /* The contract uses a single uint256 slot:
         1 = _ENTERED   (function currently executing)
         2 = _NOT_ENTERED (default)                                              */
    uint256 private _ENTERED     = 1;
    uint256 private _NOT_ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    /*  Modifier that ensures no nested (re-)entry into a function marked
        `nonReentrant`.                                                          */
    modifier nonReentrant() {
        // On the first call to nonReentrant => _status == _NOT_ENTERED
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");

        // Mark as entered
        _status = _ENTERED;

        _;  // execute the rest of the function

        // Reset to default state
        _status = _NOT_ENTERED;
    }
}