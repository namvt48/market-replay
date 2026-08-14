interface ReplayBrandMarkProps {
  className?: string
}

export function ReplayBrandMark({ className = 'size-8' }: ReplayBrandMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      data-mark="market-replay-loop"
    >
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#151923" stroke="#36558f" />
      <path d="M9.3 8.5A10 10 0 1 1 6.4 18.4" stroke="#5b8cff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M5.9 5.7v5.2h5.2" stroke="#5b8cff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12.2v8.2M16 9.9v11.7M20 12.2v8.2" stroke="#d1d4dc" strokeWidth="1.25" strokeLinecap="round" />
      <rect x="10.6" y="14.2" width="2.8" height="3.8" rx="0.7" fill="#22ab94" />
      <rect x="14.6" y="12" width="2.8" height="5.2" rx="0.7" fill="#5b8cff" />
      <rect x="18.6" y="15" width="2.8" height="3.2" rx="0.7" fill="#f23645" />
    </svg>
  )
}
