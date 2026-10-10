'use client';

import type { ReactNode } from 'react';

import { AsideProvider } from '../consultant/aside-refresh';
import { SceneAside } from '../consultant/SceneAside';
import type { SceneAsideData } from '@/server/consultant/aside';

import { Chat } from '../Chat';
import type { RestoredChat } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';

import { HeadView } from './HeadView';
import { MuteToggle, StateChip, StopButton, Subtitles } from './Speaking';
import { CompanionVoiceProvider } from './voice';
import styles from './AvatarScene.module.css';

export type AvatarSceneVariant = 'portrait' | 'inline' | 'call' | 'call-side';

/**
 * Сцены консультанта с нашей головой (варианты экрана для выбора). Сцена держит свой
 * `CompanionVoiceProvider` с автовключением озвучки на первом действии; лента `Chat` внутри
 * подхватывает его, а не создаёт свой. ConsultantScene Карины не затронут.
 *  - `portrait` — «Портрет-собеседник»: сетка 44/56, справа липкий портрет с субтитрами;
 *  - `inline` — «Голова в ленте»: липкая голова ~160px над лентой, без правой колонки;
 *  - `call` — «Видеозвонок»: голова крупно по центру, лента — полупрозрачный транскрипт снизу;
 *  - `call-side` — «Звонок + чат слева» (D = C + A): тёмный экран звонка, слева светлая панель чата
 *    на всю высоту с полной лентой и вводом; уже 1050px — панель снизу, голова сверху ~40vh.
 * `label` — подпись у головы («Помощник по подбору» у работодателя).
 * `aside` — данные правой колонки call-side под головой («Твой путь», «Документы», «Подсказка»,
 * components/consultant/SceneAside; считаются на сервере в page.tsx).
 * `children` — готовая лента (слитая лента /consultant: онбординг + консультант, см.
 * components/consultant/ConsultantFeed); без них сцена рисует обычный `Chat`.
 */
export function AvatarScene({ variant, demo, initial, children, aside, label = 'ИИ-консультант' }: { variant: AvatarSceneVariant; label?: string; demo?: ChatDemoContext; initial?: RestoredChat; children?: ReactNode; aside?: SceneAsideData }) {
  const feed = (className?: string) => children ?? <Chat demo={demo} initial={initial} className={className} />;
  return (
    <CompanionVoiceProvider autoEnable>
      <AsideProvider initial={aside}>
      {variant === 'portrait' && (
        <div className={styles.portraitScene} data-testid="scene-portrait">
          <div className={styles.conversation}>
            {feed()}
          </div>
          <aside className={styles.portrait} aria-label={label}>
            <HeadView />
            <span className={styles.badge}>{label}</span>
            <div className={styles.callTop}>
              <MuteToggle />
            </div>
            <div className={styles.under}>
              <StateChip />
              <Subtitles />
            </div>
          </aside>
        </div>
      )}
      {variant === 'inline' && (
        <div className={styles.inlineScene} data-testid="scene-inline">
          <div className={styles.dock}>
            <div className={styles.dockHead}>
              <HeadView />
            </div>
            <div className={styles.dockInfo}>
              <span className={styles.dockName}>ИИ-консультант</span>
              <StateChip className={styles.dockChip} />
              <div className={styles.dockButtons}>
                <MuteToggle />
                <StopButton />
              </div>
            </div>
          </div>
          <div className={styles.inlineChat}>
            {children ? <div className={styles.feedBox}>{children}</div> : feed(styles.inlineChatBox)}
          </div>
        </div>
      )}
      {variant === 'call' && (
        <div className={styles.callScene} data-testid="scene-call">
          <div className={styles.callHead}>
            <HeadView />
            <span className={styles.badge}>{label}</span>
            <div className={styles.callTop}>
              <StateChip />
              <MuteToggle />
            </div>
            <div className={styles.callStop}>
              <StopButton />
            </div>
          </div>
          <div className={styles.callTranscript}>
            {children ? <div className={styles.feedBox}>{children}</div> : feed(styles.callChat)}
          </div>
        </div>
      )}
      {variant === 'call-side' && (
          <div className={`${styles.sideScene}${aside ? ` ${styles.withAside}` : ''}`} data-testid="scene-call-side">
            <section className={styles.sideStage} aria-label={label}>
              <div className={styles.sideHead}>
                <HeadView />
                <span className={styles.badge}>{label}</span>
                <div className={styles.callTop}>
                  <StateChip />
                  <MuteToggle />
                </div>
                <div className={styles.callStop}>
                  <StopButton />
                </div>
              </div>
              <Subtitles className={styles.sideSubs} />
            </section>
            {aside && <SceneAside data={aside} className={styles.sideAside} />}
            <div className={styles.sidePanel} data-testid="side-panel" data-feed-scroll data-theme="feed-dark">
              {feed(styles.sideChat)}
            </div>
          </div>
      )}
      </AsideProvider>
    </CompanionVoiceProvider>
  );
}
