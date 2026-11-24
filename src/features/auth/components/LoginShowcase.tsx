'use client';

import { useTranslations } from 'next-intl';

function PriorityBars({ level, label }: { level: 1 | 2 | 3 | 4; label: string }) {
  return (
    <span className={`ui-prio p${level}`}>
      <span className="ui-prio-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <i key={bar} className={bar <= level ? 'on' : undefined} />
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function ShowcaseColumn({
  title,
  cards,
}: {
  title: string;
  cards: readonly { title: string; level: 1 | 2 | 3 | 4; levelLabel: string; hidden?: boolean }[];
}) {
  return (
    <div className="login-mini-col">
      <div className="login-mini-head">
        <span>{title}</span>
        <b>{cards.length}</b>
      </div>
      {cards.map((card) => (
        <div key={card.title} className={`login-mini-card${card.hidden ? ' is-hidden' : ''}`}>
          <span className="login-mini-title">{card.title}</span>
          <span className="login-mini-meta">
            <PriorityBars level={card.level} label={card.levelLabel} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function LoginShowcase() {
  const tApp = useTranslations('app');
  const tAuth = useTranslations('auth.showcase');
  const tPrio = useTranslations('priority');
  return (
    <section className="login-left" aria-hidden="true">
      <div className="login-brand-row">
        <div className="login-word">
          <span className="ui-logo"><i /><i /><i /><i /></span>
          <span className="login-word-text"><b>{tApp('name')}</b><span>{tApp('subtitle')}</span></span>
        </div>
        <span className="login-left-tag">{tAuth('tag')}</span>
      </div>
      <div className="login-copy">
        <span className="login-copy-kicker">{tAuth('kicker')}</span>
        <h2>{tAuth('headline')}</h2>
      </div>
      <div className="login-board-wrap">
        <div className="login-mini">
          <ShowcaseColumn
            title={tAuth('columns.todo')}
            cards={[
              { title: tAuth('sampleTasks.t1'), level: 3, levelLabel: tPrio('high') },
              { title: tAuth('sampleTasks.t2'), level: 1, levelLabel: tPrio('low') },
            ]}
          />
          <ShowcaseColumn
            title={tAuth('columns.doing')}
            cards={[
              { title: tAuth('sampleTasks.t3'), level: 4, levelLabel: tPrio('urgent') },
              { title: tAuth('sampleTasks.t4'), level: 4, levelLabel: tPrio('urgent'), hidden: true },
            ]}
          />
          <ShowcaseColumn
            title={tAuth('columns.done')}
            cards={[
              { title: tAuth('sampleTasks.t5'), level: 3, levelLabel: tPrio('high') },
              { title: tAuth('sampleTasks.t6'), level: 2, levelLabel: tPrio('medium') },
            ]}
          />
        </div>
      </div>
      <p className="login-caption">{tAuth('caption')}</p>
    </section>
  );
}
