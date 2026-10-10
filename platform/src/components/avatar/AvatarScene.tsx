'use client';

import { Chat } from '../Chat';
import type { RestoredChat } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';

import { HeadView } from './HeadView';
import { MuteToggle, StateChip, StopButton, Subtitles } from './Speaking';
import { CompanionVoiceProvider } from './voice';
import styles from './AvatarScene.module.css';

export type AvatarSceneVariant = 'portrait' | 'inline' | 'call';

/**
 * Сцены консультанта с нашей головой (варианты экрана для выбора). Сцена держит свой
 * `CompanionVoiceProvider` с автовключением озвучки на первом действии; лента `Chat` внутри
 * подхватывает его, а не создаёт свой. ConsultantScene Карины не затронут.
 *  - `portrait` — «Портрет-собеседник»: сетка 44/56, справа липкий портрет с субтитрами;
 *  - `inline` — «Голова в ленте»: липкая голова ~160px над лентой, без правой колонки;
 *  - `call` — «Видеозвонок»: голова крупно по центру, лента — полупрозрачный транскрипт снизу.
 */
export function AvatarScene({ variant, demo, initial }: { variant: AvatarSceneVariant; demo?: ChatDemoContext; initial?: RestoredChat }) {
  return (
    <CompanionVoiceProvider autoEnable>
      {variant === 'portrait' && (
        <div className={styles.portraitScene} data-testid="scene-portrait">
          <div className={styles.conversation}>
            <Chat demo={demo} initial={initial} />
          </div>
          <aside className={styles.portrait} aria-label="ИИ-консультант">
            <HeadView />
            <span className={styles.badge}>ИИ-консультант</span>
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
            <Chat demo={demo} initial={initial} className={styles.inlineChatBox} />
          </div>
        </div>
      )}
      {variant === 'call' && (
        <div className={styles.callScene} data-testid="scene-call">
          <div className={styles.callHead}>
            <HeadView />
            <span className={styles.badge}>ИИ-консультант</span>
            <div className={styles.callTop}>
              <StateChip />
              <MuteToggle />
            </div>
            <div className={styles.callStop}>
              <StopButton />
            </div>
          </div>
          <div className={styles.callTranscript}>
            <Chat demo={demo} initial={initial} className={styles.callChat} />
          </div>
        </div>
      )}
    </CompanionVoiceProvider>
  );
}
