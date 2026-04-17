import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './lib/i18n';

export default createMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: 'as-needed',
});

export const config = {
  // /apps/, /dashboard を含む全パス対象（_next, api, static 除外）
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
