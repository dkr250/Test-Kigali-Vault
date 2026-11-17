interface BrandLogoProps {
  variant?: 'light' | 'dark';
  compact?: boolean;
}

export function BrandLogo({ variant = 'light', compact = false }: BrandLogoProps) {
  const isDark = variant === 'dark';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap select-none">
      <svg
        viewBox="0 0 32 32"
        className={compact ? 'w-6 h-6 shrink-0' : 'w-7 h-7 shrink-0'}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect
          x="1.5"
          y="1.5"
          width="29"
          height="29"
          rx="7"
          fill={isDark ? '#142E52' : '#0B1F3A'}
          stroke="#C99E44"
          strokeWidth="1.5"
        />
        <path
          d="M9 10.5V21.5M9 16L14.5 10.5M11.8 13.2L15.2 21.5"
          stroke="#F8F1E1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M17.5 10.5L20.5 21.5L23.5 10.5"
          stroke="#C99E44"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`font-display font-bold tracking-tight ${
          compact ? 'text-sm' : 'text-lg'
        } ${isDark ? 'text-white' : 'text-[#0B1F3A]'}`}
      >
        Kigali Vault
      </span>
    </span>
  );
}
