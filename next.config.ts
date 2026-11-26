import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { buildNextHeaderRules } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return buildNextHeaderRules({ nodeEnv: process.env.NODE_ENV });
  },
};

export default withNextIntl(nextConfig);
