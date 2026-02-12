import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt, fallback, size = 'md', ...props }, ref) => {
    const sizes = {
      sm: 'w-8 h-8 text-xs',
      md: 'w-10 h-10 text-sm',
      lg: 'w-12 h-12 text-base',
      xl: 'w-16 h-16 text-lg',
    };

    const initials = fallback
      ? fallback
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : '?';

    return (
      <div
        ref={ref}
        className={cn(
          'relative flex shrink-0 items-center justify-center rounded-full bg-secondary overflow-hidden',
          sizes[size],
          className
        )}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={alt || fallback || 'Avatar'}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="font-medium text-muted-foreground">{initials}</span>
        )}
      </div>
    );
  }
);

Avatar.displayName = 'Avatar';
