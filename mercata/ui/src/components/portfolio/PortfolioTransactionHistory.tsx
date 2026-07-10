import ActivityFeedList from "@/components/dashboard/ActivityFeedList";

/**
 * Transaction history for the portfolio page. Reuses the existing activity feed
 * (self-contained: its own fetching, filters and pagination) so we don't
 * duplicate event rendering. The feed's built-in filters let the user narrow to
 * their own activity and by contract/event type.
 */
const PortfolioTransactionHistory = () => {
  return (
    <section className="mb-6">
      <h2 className="text-base md:text-lg font-semibold mb-3">Transaction History</h2>
      <ActivityFeedList />
    </section>
  );
};

export default PortfolioTransactionHistory;
