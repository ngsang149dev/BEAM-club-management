import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';

const WORKSPACE_CARDS = [
  { key: 'boards', href: '/boards' },
  { key: 'myTasks', href: '/my-tasks' },
  { key: 'members', href: '/members' },
  { key: 'profile', href: '/profile' },
] as const;

const PRIORITY_ITEMS = [
  { level: 1, key: 'low' },
  { level: 2, key: 'medium' },
  { level: 3, key: 'high' },
  { level: 4, key: 'urgent' },
] as const;

export default async function HomePage() {
  const [tHome, tNav, tPriority] = await Promise.all([
    getTranslations('home'),
    getTranslations('nav'),
    getTranslations('priority'),
  ]);

  return (
    <AppShell breadcrumb={tHome('kicker')} title={tHome('title')}>
      <div className="home-page">
        <header className="home-head">
          <span className="home-kicker">{tHome('kicker')}</span>
          <h1>{tHome('title')}</h1>
          <p>{tHome('subtitle')}</p>
        </header>

        <section className="ui-banner" aria-live="polite">
          <div>
            <span className="ui-banner-title">{tHome('statusTitle')}</span>
            <span className="ui-banner-text">{tHome('statusDescription')}</span>
          </div>
        </section>

        <section>
          <h2 className="home-section-title">{tHome('quickLinksTitle')}</h2>
          <div className="home-grid">
            {WORKSPACE_CARDS.map((card) => (
              <Link key={card.key} href={card.href} className="home-card">
                <span className="home-card-title">{tNav(card.key)}</span>
                <p className="home-card-body">{tHome(`cards.${card.key}`)}</p>
                <span className="home-card-cta">{tHome('openSection')} &rarr;</span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="home-section-title">{tHome('priorityLegendTitle')}</h2>
          <div className="home-prio-row">
            {PRIORITY_ITEMS.map((item) => (
              <span key={item.level} className={`ui-prio p${item.level}`}>
                <span className="ui-prio-bars" aria-hidden="true">
                  {[1, 2, 3, 4].map((bar) => (
                    <i key={bar} className={bar <= item.level ? 'on' : undefined} />
                  ))}
                </span>
                <span>{tPriority(item.key)}</span>
              </span>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
