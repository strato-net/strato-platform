/**
 * Notification Preferences
 *
 * Users' notification preferences for agreement exceptions
 */

contract record Notification {
  enum Notification {
    NONE,
    EMAIL,
    SMS,
    BOTH
  }
}
