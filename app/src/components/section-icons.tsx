import React from 'react';

// Line icons drawn in currentColor so themes control their colour through `color`.
const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const MailIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M3.5 6l8.5 7 8.5-7" />
  </Svg>
);
MailIcon.displayName = 'MailIcon';

export const CalendarIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="16" rx="1.5" />
    <path d="M3 10h18M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2" />
  </Svg>
);
CalendarIcon.displayName = 'CalendarIcon';

export const ContactsIcon = () => (
  <Svg>
    <circle cx="12" cy="8.5" r="4" />
    <path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" />
  </Svg>
);
ContactsIcon.displayName = 'ContactsIcon';

export const MoreIcon = () => (
  <Svg>
    <circle cx="6" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="18" cy="12" r="1" />
  </Svg>
);
MoreIcon.displayName = 'MoreIcon';
