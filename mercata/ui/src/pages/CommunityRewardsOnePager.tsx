import pageUrl from "../strato-memecoin-partnership-onepager.html?url";

/**
 * Full-page iframe for the standalone HTML one-pager (served from bundled asset URL).
 */
const CommunityRewardsOnePager = () => (
  <main className="fixed inset-0 z-[100] bg-[#F4F5FB]">
    <iframe title="STRATO Community Partnership Program" src={pageUrl} className="h-full w-full border-0" />
  </main>
);

export default CommunityRewardsOnePager;
