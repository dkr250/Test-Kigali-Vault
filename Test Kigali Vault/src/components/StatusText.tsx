interface StatusTextProps {
  status: string;
}

export function StatusText({ status }: StatusTextProps) {
  const s = status.toLowerCase();
  let colorClass = 'text-slate-700';

  if (
    s.includes('approved') ||
    s.includes('completed') ||
    s.includes('available') ||
    s === 'active'
  ) {
    colorClass = 'text-[#15803D] font-semibold';
  } else if (
    s.includes('pending') ||
    s.includes('confirmed') ||
    s.includes('ready') ||
    s.includes('delivery')
  ) {
    colorClass = 'text-[#B45309] font-semibold';
  } else if (
    s.includes('rejected') ||
    s.includes('cancelled') ||
    s.includes('suspended') ||
    s.includes('deactivated') ||
    s.includes('out of stock') ||
    s.includes('archived')
  ) {
    colorClass = 'text-[#B91C1C] font-semibold';
  }

  const label = status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return <span className={`text-xs tracking-wide whitespace-nowrap ${colorClass}`}>{label}</span>;
}
