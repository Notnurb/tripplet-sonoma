'use client';

import type { RefObject } from 'react';
import { motion, type Variants } from 'framer-motion';

type TimelineVariants = Variants;

type TimelineContentProps = {
  as?: 'div' | 'p';
  animationNum?: number;
  timelineRef?: RefObject<HTMLElement | HTMLDivElement | null>;
  customVariants?: TimelineVariants;
  className?: string;
  children: React.ReactNode;
};

const defaultVariants: TimelineVariants = {
  hidden: {
    opacity: 0,
    y: 24,
    filter: 'blur(8px)',
  },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.55,
      delay: index * 0.08,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  }),
};

export function TimelineContent({
  as = 'div',
  animationNum = 0,
  timelineRef: _timelineRef,
  customVariants = defaultVariants,
  className,
  children,
}: TimelineContentProps) {
  const Component = as === 'p' ? motion.p : motion.div;

  return (
    <Component
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      custom={animationNum}
      variants={customVariants}
      className={className}
    >
      {children}
    </Component>
  );
}
