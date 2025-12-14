import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

function shortenAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 10) return address;
  const prefix = address.startsWith('0x') ? '0x' : '';
  const trimmed = address.startsWith('0x') ? address.slice(2) : address;
  return `${prefix}${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

type AddressDisplayProps = {
  address: string;
  className?: string;
  size?: 'sm' | 'md';
  showCopy?: boolean;
};

export function AddressDisplay({ address, className, size = 'md', showCopy = true }: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);
  const display = useMemo(() => shortenAddress(address), [address]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const textClasses =
    size === 'sm'
      ? 'text-xs px-2 py-1'
      : 'text-sm px-2.5 py-1.5';

  return (
    <div className={cn('inline-flex items-center gap-2 group relative', className)} title={address}>
      <span className={cn('font-mono rounded bg-muted/50 border border-border break-all', textClasses)}>
        {display}
      </span>
      <span className="sr-only">Full address: {address}</span>
      {showCopy && (
        <button
          type="button"
          onClick={copy}
          className="text-xs px-2 py-1 rounded border border-border bg-background hover:bg-muted transition"
          aria-label="Copy address"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      )}
    </div>
  );
}
