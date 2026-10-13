/** Shown on every page: this is a student prototype, not a P&G product. */
export default function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-[11px] text-ink-muted ${className}`}>
      Academic prototype for presentation only. Not an official P&amp;G product or endorsed by P&amp;G. The P&amp;G name and logo are
      trademarks of The Procter &amp; Gamble Company.
    </p>
  );
}
