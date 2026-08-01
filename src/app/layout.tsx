import type { Metadata } from 'next';

import { AppShell } from '@/components/shell/app-shell';
import packageJson from '../../package.json';

import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'MidasAI',
  description:
    'An honest research environment for algorithmic trading — pre-registered experiments, permutation tests, and agents on rails.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell version={packageJson.version}>{children}</AppShell>
      </body>
    </html>
  );
}
