import type { ReactNode, SVGProps } from 'react';

function Icon({
  children,
  ...props
}: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </Icon>
  );
}

export function IconRows(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <rect x="3" y="12" width="18" height="5" rx="1" />
      <path d="M3 20h12" />
    </Icon>
  );
}

export function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Icon>
  );
}

export function IconGuide(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18" />
      <path d="M9 9v11" />
    </Icon>
  );
}

export function IconHistory(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
      <path d="M12 8v4l3 2" />
    </Icon>
  );
}

export function IconTv(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="6" width="18" height="13" rx="1.5" />
      <path d="m8.5 2.5 3.5 3 3.5-3" />
    </Icon>
  );
}

export function IconPlay(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 3.5V8h-4.5" />
    </Icon>
  );
}

export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="14" height="14" {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function IconChevronUp(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="14" height="14" {...props}>
      <path d="m6 15 6-6 6 6" />
    </Icon>
  );
}

export function IconGrip(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="14" height="14" strokeWidth="0" fill="currentColor" {...props}>
      <circle cx="9" cy="5.5" r="1.6" />
      <circle cx="15" cy="5.5" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18.5" r="1.6" />
      <circle cx="15" cy="18.5" r="1.6" />
    </Icon>
  );
}
