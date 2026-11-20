/** Three dots that blink in turn, after the label of a call that is waiting. */
const WaitingDots = () =>
  [0, 200, 400].map((delay) => (
    <span key={delay} className="animate-dot-blink" style={{ animationDelay: `${delay}ms` }}>.</span>
  ));

export default WaitingDots;
