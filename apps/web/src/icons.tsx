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

export function IconEye(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function IconEyeOff(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <path d="m4 4 16 16" />
    </Icon>
  );
}

export function IconLink(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Icon>
  );
}

export function IconServer(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="7" rx="1" />
      <rect x="3" y="13" width="18" height="7" rx="1" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Icon>
  );
}

export function IconFilm(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="m10 9 5 3-5 3z" />
    </Icon>
  );
}
