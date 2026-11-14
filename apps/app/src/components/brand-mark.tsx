export function BrandMark({
  className = 'brand-mark',
}: {
  className?: string;
}) {
  return (
    <img
      className={className}
      src={
        className === 'invoice-logo' ? '/hexa-logo-ink.svg' : '/hexa-logo.svg'
      }
      alt="Hexa logo"
    />
  );
}
