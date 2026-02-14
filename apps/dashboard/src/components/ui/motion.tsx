import { type ReactNode } from 'react';
import { motion, AnimatePresence, type HTMLMotionProps } from 'motion/react';
import { cn } from '../../lib/utils';

// ── Variants ──────────────────────────────────────────────

export const fadeSlideUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

// ── AnimatedPage ──────────────────────────────────────────

export function AnimatedPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── AnimatedStagger ───────────────────────────────────────

export function AnimatedStagger({
  children,
  className,
  delay = 0.06,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: delay } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── AnimatedItem ──────────────────────────────────────────

export function AnimatedItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={fadeSlideUp}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── AnimatedCard (stat cards with hover lift + glow) ──────

export function AnimatedCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={fadeSlideUp}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      whileHover={{
        y: -2,
        boxShadow: '0 20px 40px -12px rgba(0,0,0,0.35), 0 8px 16px -8px rgba(0,0,0,0.2)',
        transition: { duration: 0.25, ease: 'easeOut' },
      }}
      className={cn('glass-card rounded-2xl p-5 transition-colors', className)}
    >
      {children}
    </motion.div>
  );
}

// ── AnimatedTableBody + AnimatedTableRow ──────────────────

export function AnimatedTableBody({
  children,
  ...props
}: HTMLMotionProps<'tbody'>) {
  return (
    <motion.tbody
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
      {...props}
    >
      {children}
    </motion.tbody>
  );
}

export function AnimatedTableRow({
  children,
  className,
  ...props
}: HTMLMotionProps<'tr'>) {
  return (
    <motion.tr
      variants={{
        hidden: { opacity: 0, y: 6 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={className}
      {...props}
    >
      {children}
    </motion.tr>
  );
}

// ── ContentTransition ─────────────────────────────────────

export function ContentTransition({
  isLoading,
  loadingContent,
  children,
}: {
  isLoading: boolean;
  loadingContent: ReactNode;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode="wait">
      {isLoading ? (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {loadingContent}
        </motion.div>
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Re-exports ────────────────────────────────────────────

export { motion, AnimatePresence };
