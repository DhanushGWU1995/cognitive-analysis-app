import { CommonModule } from '@angular/common';
import { Component, HostBinding, computed, effect, signal, untracked } from '@angular/core';
import * as XLSX from 'xlsx';

type TrialTouch = {
  press: number;
  ms: number;
  choice: number;
  gridCell: number;
  expected: number;
  correct: boolean;
  /** Re-tap of an already-correct step — recorded, never an error. */
  repeat: boolean;
  ignored: boolean;
  automatic: boolean;
};

type TrialReportMeta = {
  trialInList: number;
  listNum: number;
  trialsNum: number;
  totalTrialsNum: number;
  stepsNum: number;
  studySeconds: number;
  itiSeconds: number;
  distractorsN: number;
  feedbackBorder: boolean;
  freeRecall: boolean;
  progressCorrectOnly: boolean;
  playSound: boolean;
  listPics: string;
  listLocations: string;
};

type TrialResult = {
  trial: number;
  taskType: 'location' | 'picture';
  testMode: string;
  isDemo: boolean;
  sequence: number[];
  presses: number[];
  touches: TrialTouch[];
  correct: boolean;
  ms: number;
  trialSessionStartMs: number;
  locTrialPic?: number;
  report: TrialReportMeta;
};

/** Browser/local backup so data survives refresh, crash, or quit before Excel download. */
type SessionCheckpoint = {
  version: 1;
  savedAt: number;
  downloaded: boolean;
  subjectId: string;
  taskType: 'location' | 'picture';
  testMode: string;
  trialsPlanned: number;
  sessionEndedEarly: boolean;
  sessionDateIso: string;
  results: TrialResult[];
};

const SESSION_CHECKPOINT_KEY = 'select-toddler-session-checkpoint-v1';

/** SELeCT legacy report columns (matches report_template.txt + ListNum before SequenceBy). */
const LEGACY_REPORT_HEADER = [
  'Sub',
  'Date',
  'Press',
  'Trial',
  '',
  'SequenceBy',
  'ItemPressed',
  'CorrectItem',
  'Progress',
  'PressAccuracy',
  'TrialAccuracy',
  'RT',
  'SessionTime',
  'ListNum',
  'ListPics',
  'ListLocations',
  'TrialsNum',
  'TotalTrialsNum',
  'StepsNum',
  'TO',
  'ITI',
  'DistractorsEnable',
  'BlackBorder',
  'PlaySound',
  'FreeRecall',
  'TapMode',
  'ProgressCorrectOnly',
] as const;

/** Dancer celebration clips (Subia / Mail Drop). Playback capped by reward length (≤5s). */
const REWARD_VIDEOS = [
  { id: 'dancer_01', src: 'assets/video/reward/dancer_01.mp4', title: 'You did it!', sub: 'Dance party — great job!' },
  { id: 'dancer_02', src: 'assets/video/reward/dancer_02.mp4', title: 'Yay!', sub: 'Look at those moves!' },
  { id: 'dancer_03', src: 'assets/video/reward/dancer_03.mp4', title: 'Party time!', sub: 'You finished — woohoo!' },
  { id: 'dancer_04', src: 'assets/video/reward/dancer_04.mp4', title: 'So happy!', sub: 'What wonderful work!' },
  { id: 'dancer_05', src: 'assets/video/reward/dancer_05.mp4', title: 'Smile!', sub: 'You did such a good job!' },
  { id: 'dancer_06', src: 'assets/video/reward/dancer_06.mp4', title: 'Hooray!', sub: 'Keep up the great work!' },
  { id: 'dancer_07', src: 'assets/video/reward/dancer_07.mp4', title: 'Awesome!', sub: 'Boogie on — nice work!' },
  { id: 'dancer_08', src: 'assets/video/reward/dancer_08.mp4', title: 'Super!', sub: 'That was fantastic!' },
  { id: 'dancer_09', src: 'assets/video/reward/dancer_09.mp4', title: 'Wow!', sub: 'You are a star!' },
  { id: 'dancer_10', src: 'assets/video/reward/dancer_10.mp4', title: 'Yes!', sub: 'Celebrate — you did it!' },
] as const;

/** Built-in Object-task pictures shipped as assets/pics/001.jpg … N.jpg. */
const MAX_PIC_ID = 99;
/** Custom uploads (in-app) get ids starting here; stored in IndexedDB on this device. */
const CUSTOM_PIC_START = MAX_PIC_ID + 1;
const CUSTOM_PICS_DB = 'select-custom-pics';
const CUSTOM_PICS_STORE = 'pics';

type CustomPicRecord = { id: number; mime: string; blob: Blob; addedAt: number };

function openCustomPicsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(CUSTOM_PICS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CUSTOM_PICS_STORE)) {
        db.createObjectStore(CUSTOM_PICS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function listCustomPicRecords(): Promise<CustomPicRecord[]> {
  const db = await openCustomPicsDb();
  try {
    const tx = db.transaction(CUSTOM_PICS_STORE, 'readonly');
    const rows = await idbReq(tx.objectStore(CUSTOM_PICS_STORE).getAll() as IDBRequest<CustomPicRecord[]>);
    return (rows ?? []).slice().sort((a, b) => a.id - b.id);
  } finally {
    db.close();
  }
}

async function putCustomPicRecord(rec: CustomPicRecord): Promise<void> {
  const db = await openCustomPicsDb();
  try {
    const tx = db.transaction(CUSTOM_PICS_STORE, 'readwrite');
    await idbReq(tx.objectStore(CUSTOM_PICS_STORE).put(rec));
  } finally {
    db.close();
  }
}

async function deleteCustomPicRecord(id: number): Promise<void> {
  const db = await openCustomPicsDb();
  try {
    const tx = db.transaction(CUSTOM_PICS_STORE, 'readwrite');
    await idbReq(tx.objectStore(CUSTOM_PICS_STORE).delete(id));
  } finally {
    db.close();
  }
}

/** Downscale / re-encode uploads so IndexedDB stays small. */
async function normalizeUploadImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 640;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
    );
    if (!blob) throw new Error('Could not encode image');
    return blob;
  } finally {
    bitmap.close();
  }
}

type RewardVideoClip = (typeof REWARD_VIDEOS)[number];

/** Cute visual fallbacks if a video cannot play. */
const SURPRISE_REWARDS: Array<{
  id: string;
  emoji: string;
  burst: string;
  title: string;
  sub: string;
}> = [
  { id: 'clap', emoji: '👏', burst: '✨', title: 'Yay!', sub: 'Clap clap — you did it!' },
  { id: 'stars', emoji: '⭐', burst: '🌟', title: 'Super star!', sub: 'Shiny work!' },
  { id: 'jump', emoji: '🐰', burst: '💗', title: 'Jump for joy!', sub: 'Hop hop — great job!' },
  { id: 'party', emoji: '🎉', burst: '🎊', title: 'Party time!', sub: 'Woohoo — you finished!' },
  { id: 'song', emoji: '🎵', burst: '🎶', title: 'Sing along!', sub: 'What a wonderful job!' },
  { id: 'heart', emoji: '💖', burst: '✨', title: 'So proud!', sub: 'You did amazing!' },
];

/** Layered cheer for successful trial completion (congratulatory, kid-friendly). */
const CHEER_LAYERS: Array<{ src: string; volume: number; delayMs: number }> = [
  { src: 'assets/sfx/cheer_chimes.mp3', volume: 0.85, delayMs: 0 },
  { src: 'assets/sfx/cheer_yay.mp3', volume: 0.9, delayMs: 100 },
  { src: 'assets/sfx/cheer_applause.mp3', volume: 0.72, delayMs: 220 },
];

const DEFAULT_LOCATION_ROWS: number[][] = [
  [13, 6],
  [10, 3],
  [14, 11],
  [2, 5],
  [7, 16],
];

const DEFAULT_PICTURE_ROWS: number[][] = [
  [13, 5],
  [8, 2],
  [21, 7],
  [11, 19],
  [3, 15],
];

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  template: `
    <div class="app-shell" [class.run-screen]="screen() === 'run'">
      <header class="topbar">
        <div class="brand">
          <div class="logo">SELeCT</div>
          <div class="subtitle">Toddler Memory (Web)</div>
        </div>
        <div class="topbar-right">
          <div class="topbar-actions" *ngIf="screen() === 'run' || screen() === 'results'">
            <div class="chip" *ngIf="screen() === 'run'">Trial {{ trialIndex() + 1 }} / {{ trials() }}</div>
            <button
              type="button"
              class="btn ghost topbar-btn early-finish-btn"
              *ngIf="screen() === 'run'"
              title="Stop testing and save data collected so far"
              (click)="finishEarly()"
            >
              Early Finish
            </button>
            <button type="button" class="btn ghost topbar-btn" (click)="returnToSetup()">Edit setup</button>
          </div>
          <button
            *ngIf="isDesktopApp"
            type="button"
            class="desktop-exit-btn"
            title="Exit app"
            aria-label="Exit app"
            (click)="exitDesktopApp()"
          >
            Exit
          </button>
        </div>
      </header>

      <main class="main">
        <section class="card" *ngIf="screen() === 'home'">
          <h1>Pick a game</h1>
          <p class="muted">Runs entirely in the browser (GitHub Pages). Works best in fullscreen.</p>

          <div class="recovery-banner" *ngIf="pendingRecovery() as recovery">
            <div class="recovery-title">Unsaved session backup found</div>
            <p class="muted small">
              Subject <b>{{ recovery.subjectId }}</b> · {{ recovery.results.length }} trial(s) ·
              {{ recovery.taskType === 'location' ? 'Spatial' : 'Object' }} ·
              saved {{ recoverySavedLabel() }}
            </p>
            <div class="actions" style="margin-top: 10px">
              <button type="button" class="btn primary" (click)="downloadRecoveredReport()">Download backup report</button>
              <button type="button" class="btn ghost" (click)="discardRecovery()">Discard</button>
            </div>
          </div>

          <div class="grid2">
            <button class="big-btn" (click)="goSetup(TaskType.Location)">
              <div class="emoji">📍</div>
              <div class="txt">
                <div class="t">Spatial Task</div>
                <div class="d">Remember locations.</div>
              </div>
            </button>
            <button class="big-btn" (click)="goSetup(TaskType.Picture)">
              <div class="emoji">🖼️</div>
              <div class="txt">
                <div class="t">Object Task</div>
                <div class="d">Remember pictures.</div>
              </div>
            </button>
          </div>
          <div class="footer-row">
            <a class="link" href="https://github.com/DhanushGWU1995/cognitive-analysis-app" target="_blank" rel="noopener">
              View repo
            </a>
          </div>
        </section>

        <section class="card" *ngIf="screen() === 'setup'">
          <h1>Setup</h1>
          <p class="muted">Task: <b>{{ taskTitle() }}</b> — {{ taskTagline() }}</p>

          <div class="form">
            <label>
              <div class="lbl">Subject ID</div>
              <input [value]="subjectId()" (input)="subjectId.set(($any($event.target).value || '').toString())" />
            </label>
            <label>
              <div class="lbl">Trials</div>
              <input type="number" min="1" max="50" [value]="trials()" (input)="trials.set(+$any($event.target).value)" />
            </label>
            <label>
              <div class="lbl">StepsNum (sequence length, max {{ maxStepsNum() }})</div>
              <input
                type="number"
                min="1"
                [max]="maxStepsNum()"
                [value]="stepsNum()"
                (input)="setStepsNum(+$any($event.target).value)"
              />
            </label>
            <label>
              <div class="lbl">Distractors (N)</div>
              <input type="number" min="0" max="12" [value]="distractorsN()" (input)="distractorsN.set(+$any($event.target).value)" />
            </label>
            <label>
              <div class="lbl">
                Study timer (seconds per item; 0 = skip study, no flash)
                <span *ngIf="automaticDemo()" class="muted"> — off while Automatic watch is on</span>
              </div>
              <input
                type="number"
                min="0"
                max="10"
                [value]="automaticDemo() ? 0 : studySeconds()"
                [disabled]="automaticDemo()"
                (input)="studySeconds.set(+$any($event.target).value)"
              />
            </label>
          </div>

          <div class="test-mode-picker">
            <h2>Test mode</h2>
            <p class="muted small">Applies to Spatial and Object tasks. Pick a preset, then fine-tune below if needed.</p>
            <div class="test-mode-options">
              <label class="test-mode-card" [class.selected]="testMode() === TestMode.Standard">
                <span class="test-mode-head">
                  <input
                    type="radio"
                    name="testMode"
                    [checked]="testMode() === TestMode.Standard"
                    (change)="setTestMode(TestMode.Standard)"
                  />
                  <span class="test-mode-title">(A) Standard test</span>
                </span>
                <span class="test-mode-desc"
                  >Border + correct sound on right taps. Wrong sound, grid clears, next trial on error.</span
                >
              </label>
              <label class="test-mode-card" [class.selected]="testMode() === TestMode.FreeRecall">
                <span class="test-mode-head">
                  <input
                    type="radio"
                    name="testMode"
                    [checked]="testMode() === TestMode.FreeRecall"
                    (change)="setTestMode(TestMode.FreeRecall)"
                  />
                  <span class="test-mode-title">(B) Free recall</span>
                </span>
                <span class="test-mode-desc"
                  >Find all targets in any order — unlimited attempts. Trial ends only when every target is
                  touched. Use (C) for ordered sequence.</span
                >
              </label>
              <label class="test-mode-card" [class.selected]="testMode() === TestMode.AdvanceWhenCorrect">
                <span class="test-mode-head">
                  <input
                    type="radio"
                    name="testMode"
                    [checked]="testMode() === TestMode.AdvanceWhenCorrect"
                    (change)="setTestMode(TestMode.AdvanceWhenCorrect)"
                  />
                  <span class="test-mode-title">(C) Advance when correct</span>
                </span>
                <span class="test-mode-desc">Wrong sound on errors. Trial continues until the sequence is correct.</span>
              </label>
            </div>
          </div>

          <div class="feedback-flags">
            <h2>Step feedback (Spatial and Object tasks)</h2>
            <p class="muted small">Shown on the grid after each correct tap during test.</p>
            <div class="flag-grid">
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackBorder()"
                  (change)="feedbackBorder.set($any($event.target).checked)"
                />
                <span>Border highlight</span>
              </label>
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackStepNumber()"
                  (change)="feedbackStepNumber.set($any($event.target).checked)"
                />
                <span>Step number</span>
              </label>
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackSmiley()"
                  (change)="feedbackSmiley.set($any($event.target).checked)"
                />
                <span>Happy face</span>
              </label>
            </div>
            <p class="muted small response-hint">Sound and Correct / Try again pill during test:</p>
            <div class="flag-grid">
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackEveryResponse()"
                  (change)="feedbackEveryResponse.set($any($event.target).checked)"
                />
                <span>Every response</span>
              </label>
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackEveryError()"
                  (change)="feedbackEveryError.set($any($event.target).checked)"
                />
                <span>Every wrong tap</span>
              </label>
            </div>
            <p class="muted small">
              <b>Every response</b> on: feedback on the first touch of each step. Off: no response feedback, ever.
              <b>Every wrong tap</b> on: error cue on true mistakes. Off: no error cue, ever. Re-taps of an
              already-correct item are never errors and stay silent (Spatial and Object, all modes).
            </p>
            <div class="flag-grid" style="margin-top: 10px">
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="disappearOnCorrect()"
                  (change)="disappearOnCorrect.set($any($event.target).checked)"
                />
                <span>Disappear after correct touch</span>
              </label>
            </div>
            <p class="muted small">
              When checked, the touched picture or location hides after a correct step (both tasks, all modes).
            </p>
          </div>

          <div class="automatic-demo">
            <h2>Automatic demonstration</h2>
            <p class="muted small">
              For each <b>unique sequence</b>, the first <b>N</b> trials of that sequence are ghost demos (constant N):
              the computer highlights each correct step in order (border + sound). The teacher says “Watch!” — the
              child does not tap. Example: N=2 with sequences A,A,A,B,B → two A demos, then live A; two B demos, then
              live B. While Automatic watch is on, the <b>Study timer is disabled</b> for the whole session (demos
              replace study — otherwise kids see two sequence playbacks). Use <b>Seconds per demo step</b> to slow
              the watch pace; set <b>Highlights per step</b> to flash each item more than once before advancing.
            </p>
            <div class="flag-grid">
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="automaticDemo()"
                  (change)="setAutomaticDemo($any($event.target).checked)"
                />
                <span>Automatic watch trials (ghost demos)</span>
              </label>
              <label>
                <div class="lbl">Demos per unique sequence (N)</div>
                <input
                  type="number"
                  min="0"
                  max="20"
                  [value]="demoTrials()"
                  [disabled]="!automaticDemo()"
                  (input)="demoTrials.set(+$any($event.target).value)"
                />
              </label>
              <label>
                <div class="lbl">Seconds per demo step</div>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.5"
                  [value]="demoStepSeconds()"
                  [disabled]="!automaticDemo()"
                  (input)="setDemoStepSeconds(+$any($event.target).value)"
                />
              </label>
              <label>
                <div class="lbl">Highlights per step</div>
                <input
                  type="number"
                  min="1"
                  max="16"
                  [value]="demoHighlightsPerStep()"
                  [disabled]="!automaticDemo()"
                  (input)="demoHighlightsPerStep.set(+$any($event.target).value)"
                />
              </label>
            </div>
          </div>

          <div class="reward-setup">
            <h2>Reward screen</h2>
            <p class="muted small">
              Shown after a correct trial (Spatial and Object, all test modes). Automatic watch demos stay quiet.
            </p>
            <div class="reward-mode-options">
              <label class="reward-mode-card" [class.selected]="rewardMode() === RewardMode.None">
                <span class="reward-mode-head">
                  <input
                    type="radio"
                    name="rewardMode"
                    [checked]="rewardMode() === RewardMode.None"
                    (change)="rewardMode.set(RewardMode.None)"
                  />
                  <span class="reward-mode-title">No reward</span>
                </span>
                <span class="reward-mode-desc">Skip celebration; go to the next trial.</span>
              </label>
              <label class="reward-mode-card" [class.selected]="rewardMode() === RewardMode.Correct">
                <span class="reward-mode-head">
                  <input
                    type="radio"
                    name="rewardMode"
                    [checked]="rewardMode() === RewardMode.Correct"
                    (change)="rewardMode.set(RewardMode.Correct)"
                  />
                  <span class="reward-mode-title">Correct</span>
                </span>
                <span class="reward-mode-desc">Short “Correct!” card with sound. No video.</span>
              </label>
              <label class="reward-mode-card" [class.selected]="rewardMode() === RewardMode.Video">
                <span class="reward-mode-head">
                  <input
                    type="radio"
                    name="rewardMode"
                    [checked]="rewardMode() === RewardMode.Video"
                    (change)="rewardMode.set(RewardMode.Video)"
                  />
                  <span class="reward-mode-title">Video reward</span>
                </span>
                <span class="reward-mode-desc">Dancer clips with cheer music.</span>
              </label>
            </div>
            <div class="form reward-form" *ngIf="rewardMode() !== RewardMode.None">
              <label>
                <div class="lbl">Reward length (seconds, max 5)</div>
                <input
                  type="number"
                  min="1"
                  max="5"
                  [value]="rewardSeconds()"
                  (input)="setRewardSeconds(+$any($event.target).value)"
                />
              </label>
              <label *ngIf="rewardMode() === RewardMode.Video">
                <div class="lbl">Video reward type</div>
                <select
                  class="reward-select"
                  (change)="videoRewardStyle.set($any($event.target).value)"
                >
                  <option
                    value="kids"
                    [attr.selected]="videoRewardStyle() === VideoRewardStyle.Kids ? '' : null"
                  >
                    Dancer celebration
                  </option>
                  <option
                    value="surprise"
                    [attr.selected]="videoRewardStyle() === VideoRewardStyle.Surprise ? '' : null"
                  >
                    Surprise (random short clips)
                  </option>
                </select>
              </label>
            </div>
            <p class="muted small" *ngIf="rewardMode() === RewardMode.Video">
              Short dancer celebration clips plus cheer music. Surprise picks a different clip each trial (≤ 5s).
            </p>
          </div>

          <div class="seq-editor" *ngIf="taskType() === TaskType.Picture">
            <div class="seq-editor-head">
              <div>
                <h2>Object sequence</h2>
                <p class="muted small">
                  Pick a picture for each step (Object Task). StepsNum controls how many picks per trial. Use
                  <b>Copy previous</b> on a row to match the trial above it.
                </p>
              </div>
              <div class="seq-tools">
                <label class="seq-toggle">
                  <input
                    type="checkbox"
                    [checked]="sameSequenceForAllTrials()"
                    (change)="setSameSequenceForAllTrials($any($event.target).checked)"
                  />
                  <span>Same sequence for all trials</span>
                </label>
              </div>
            </div>

            <p class="seq-scroll-hint muted small" *ngIf="stepsNum() > 6">
              {{ stepsNum() }} steps — scroll horizontally to see all columns.
            </p>
            <div class="seq-table-wrap">
              <div
                class="seq-table"
                [class.seq-table--per-trial]="!sameSequenceForAllTrials()"
                [class.seq-table--synced]="sameSequenceForAllTrials()"
                [class.seq-table--equal-cols]="useEqualSeqColumns()"
                [class.seq-table--dense]="stepsNum() >= 8"
                [style.--seq-cols]="seqTableCols()"
                [style.--seq-steps]="stepsNum()"
              >
                <div class="seq-row header">
                  <div class="cell h trial-col">{{ sameSequenceForAllTrials() ? 'All trials' : 'Trial' }}</div>
                  <div class="cell h seq-copy-col" *ngIf="!sameSequenceForAllTrials()">Copy</div>
                  <div class="cell h step-col" *ngFor="let _ of [].constructor(stepsNum()); let si = index">Step {{ si + 1 }}</div>
                </div>

                <ng-container *ngIf="sameSequenceForAllTrials(); else picturePerTrialRows">
                  <div class="seq-row">
                    <div class="cell trial trial-col synced">★</div>
                    <div class="cell step-col" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                      <button class="pick pick-visual" type="button" (click)="openPicPicker(0, si)">
                        <img
                          class="pick-thumb"
                          [src]="picSrc(pictureSequences()[0][si])"
                          alt=""
                          loading="lazy"
                        />
                        <span class="pick-label">{{ pad3(pictureSequences()[0][si]) }}</span>
                      </button>
                    </div>
                  </div>
                </ng-container>
              <ng-template #picturePerTrialRows>
                <div class="seq-row" *ngFor="let _ of [].constructor(trials()); let ti = index">
                  <div class="cell trial trial-col">{{ ti + 1 }}</div>
                  <div class="cell seq-copy-col">
                    <button
                      *ngIf="ti > 0"
                      type="button"
                      class="seq-copy-prev"
                      title="Copy previous trial"
                      (click)="copyPreviousTrialSequence(ti)"
                    >
                      Copy prev
                    </button>
                  </div>
                  <div class="cell step-col" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                    <button class="pick pick-visual" type="button" (click)="openPicPicker(ti, si)">
                      <img
                        class="pick-thumb"
                        [src]="picSrc(pictureSequences()[ti][si])"
                        alt=""
                        loading="lazy"
                      />
                      <span class="pick-label">{{ pad3(pictureSequences()[ti][si]) }}</span>
                    </button>
                  </div>
                </div>
              </ng-template>
              </div>
            </div>
          </div>

          <!-- Visual picture picker overlay -->
          <div class="picker-overlay" *ngIf="picPickerOpen()" (click)="closePicPicker()">
            <div class="picker" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">
                  Pick object —
                  {{
                    sameSequenceForAllTrials()
                      ? 'All trials'
                      : 'Trial ' + (picPickerTrial() + 1)
                  }},
                  Step {{ picPickerStep() + 1 }}
                </div>
                <div class="picker-top-actions">
                  <label class="btn ghost pic-upload-btn" [class.disabled]="picUploadBusy()">
                    {{ picUploadBusy() ? 'Adding…' : 'Add pictures' }}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/*"
                      multiple
                      hidden
                      [disabled]="picUploadBusy()"
                      (change)="onCustomPicsSelected($event)"
                    />
                  </label>
                  <button class="btn ghost" type="button" (click)="closePicPicker()">Close</button>
                </div>
              </div>
              <p class="muted small pic-picker-hint">
                Tap any picture to assign it. Use <b>Add pictures</b> to upload new images on this device (saved for next
                sessions). Duplicate pictures in the same trial are checked when you tap Start.
              </p>
              <div class="picker-grid">
                <div class="picker-item-wrap" *ngFor="let pid of picIds()">
                  <button
                    class="picker-item"
                    type="button"
                    [class.pic-used]="isPicUsedElsewhereInTrial(picPickerTrial(), picPickerStep(), pid)"
                    [class.pic-custom]="isCustomPic(pid)"
                    (click)="pickPic(pid)"
                  >
                    <img class="picker-img" [src]="picSrc(pid)" alt="" loading="lazy" />
                    <div class="picker-id">{{ pad3(pid) }}{{ isCustomPic(pid) ? ' · new' : '' }}</div>
                  </button>
                  <button
                    *ngIf="isCustomPic(pid)"
                    class="pic-remove"
                    type="button"
                    title="Remove uploaded picture"
                    (click)="removeCustomPic(pid, $event)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="seq-editor" *ngIf="taskType() === TaskType.Location">
            <div class="seq-editor-head">
              <div>
                <h2>Spatial sequence</h2>
                <p class="muted small">
                  Pick a grid cell (1–16) for each step (Spatial Task). StepsNum controls how many picks per trial. Use
                  <b>Copy previous</b> on a row to match the trial above it.
                </p>
              </div>
              <div class="seq-tools">
                <label class="seq-toggle">
                  <input
                    type="checkbox"
                    [checked]="sameSequenceForAllTrials()"
                    (change)="setSameSequenceForAllTrials($any($event.target).checked)"
                  />
                  <span>Same sequence for all trials</span>
                </label>
              </div>
            </div>

            <p class="seq-scroll-hint muted small" *ngIf="stepsNum() > 6">
              {{ stepsNum() }} steps — scroll horizontally to see all columns.
            </p>
            <div class="seq-table-wrap">
              <div
                class="seq-table"
                [class.seq-table--per-trial]="!sameSequenceForAllTrials()"
                [class.seq-table--synced]="sameSequenceForAllTrials()"
                [class.seq-table--equal-cols]="useEqualSeqColumns()"
                [class.seq-table--dense]="stepsNum() >= 8"
                [style.--seq-cols]="seqTableCols()"
                [style.--seq-steps]="stepsNum()"
              >
                <div class="seq-row header">
                  <div class="cell h trial-col">{{ sameSequenceForAllTrials() ? 'All trials' : 'Trial' }}</div>
                  <div class="cell h seq-copy-col" *ngIf="!sameSequenceForAllTrials()">Copy</div>
                  <div class="cell h step-col" *ngFor="let _ of [].constructor(stepsNum()); let si = index">Step {{ si + 1 }}</div>
                </div>

                <ng-container *ngIf="sameSequenceForAllTrials(); else locationPerTrialRows">
                  <div class="seq-row">
                    <div class="cell trial trial-col synced">★</div>
                    <div class="cell step-col" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                      <button class="pick pick-loc" type="button" (click)="openLocPicker(0, si)">
                        <span class="loc-pill">{{ locationSequences()[0][si] }}</span>
                        <span class="pick-label">Cell</span>
                      </button>
                    </div>
                  </div>
                </ng-container>
                <ng-template #locationPerTrialRows>
                  <div class="seq-row" *ngFor="let _ of [].constructor(trials()); let ti = index">
                    <div class="cell trial trial-col">{{ ti + 1 }}</div>
                    <div class="cell seq-copy-col">
                      <button
                        *ngIf="ti > 0"
                        type="button"
                        class="seq-copy-prev"
                        title="Copy previous trial"
                        (click)="copyPreviousTrialSequence(ti)"
                      >
                        Copy prev
                      </button>
                    </div>
                    <div class="cell step-col" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                      <button class="pick pick-loc" type="button" (click)="openLocPicker(ti, si)">
                        <span class="loc-pill">{{ locationSequences()[ti][si] }}</span>
                        <span class="pick-label">Cell</span>
                      </button>
                    </div>
                  </div>
                </ng-template>
              </div>
            </div>
          </div>

          <!-- Location picker overlay -->
          <div class="picker-overlay" *ngIf="locPickerOpen()" (click)="closeLocPicker()">
            <div class="picker" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">
                  Pick location —
                  {{
                    sameSequenceForAllTrials()
                      ? 'All trials'
                      : 'Trial ' + (locPickerTrial() + 1)
                  }},
                  Step {{ locPickerStep() + 1 }}
                </div>
                <button class="btn ghost" type="button" (click)="closeLocPicker()">Close</button>
              </div>
              <p class="muted small loc-picker-hint">
                Tap any cell to assign it. Duplicate cells in the same trial are checked when you tap Start.
              </p>
              <div class="loc-grid">
                <button
                  class="loc-cell"
                  *ngFor="let cell of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]"
                  type="button"
                  [class.loc-used]="isLocUsedElsewhereInTrial(locPickerTrial(), locPickerStep(), cell)"
                  (click)="pickLoc(cell)"
                >
                  {{ cell }}
                </button>
              </div>
            </div>
          </div>

          <div class="actions">
            <button class="btn ghost" (click)="screen.set('home')">Back</button>
            <button class="btn primary" [disabled]="!canStart()" (click)="start()">Start</button>
          </div>

          <div class="picker-overlay" *ngIf="sequenceValidationPromptOpen()" (click)="dismissSequenceValidationPrompt()">
            <div class="picker same-seq-prompt" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">Fix sequence errors</div>
              </div>
              <p class="same-seq-prompt-copy">
                Fix the trial sequence(s) below, then tap <b>Start</b> again. The session will not begin until every
                step in each trial uses a different {{ isSpatialTask() ? 'grid cell' : 'picture' }}.
              </p>
              <ul class="validation-error-list">
                <li *ngFor="let err of sequenceValidationErrors()">{{ err }}</li>
              </ul>
              <div class="same-seq-prompt-actions">
                <button class="btn primary" type="button" (click)="dismissSequenceValidationPrompt()">OK</button>
              </div>
            </div>
          </div>

          <div class="picker-overlay" *ngIf="sameSequencePromptOpen()" (click)="declineSameSequencePrompt()">
            <div class="picker same-seq-prompt" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">Same sequence for all trials</div>
              </div>
              <p class="same-seq-prompt-copy">
                Every trial uses the same sequence. Turn on
                <b>Same sequence for all trials</b> so study runs once at the start of the session (not before each
                trial).
              </p>
              <div class="same-seq-prompt-actions">
                <button class="btn ghost" type="button" (click)="declineSameSequencePrompt()">Not now</button>
                <button class="btn primary" type="button" (click)="acceptSameSequencePrompt()">Turn on</button>
              </div>
            </div>
          </div>
        </section>

        <section class="stage" *ngIf="screen() === 'run'">
          <div class="stage-top">
            <div class="title" *ngIf="phase() === 'study'">{{ taskTitle() }}</div>
            <div class="subtitle" *ngIf="phase() === 'study'">{{ taskTagline() }}</div>
            <div class="meta" *ngIf="phase() === 'study'">
              {{ isSpatialTask() ? 'Location' : 'Picture' }} {{ stepIndex() + 1 }} of {{ trialSequence().length }} ·
              <span class="countdown">{{ countdown() }}</span>
            </div>

            <div class="study-ready" *ngIf="phase() === 'studyReady'">
              <div class="title">Study complete</div>
              <p class="subtitle" *ngIf="sameSequenceForAllTrials()">
                The same sequence applies to every trial. Continue to test when ready, or watch the study once more.
              </p>
              <p class="subtitle" *ngIf="!sameSequenceForAllTrials()">
                Ready for trial {{ trialIndex() + 1 }}? Continue to test, or watch the study sequence once more.
              </p>
              <div class="study-ready-actions">
                <button type="button" class="btn ghost" (click)="replayStudy()">Show study again</button>
                <button type="button" class="btn primary" (click)="continueToTest()">Continue to test</button>
              </div>
            </div>

            <div class="title" *ngIf="phase() === 'test' && isDemoTrial()">Watch!</div>
            <div class="title" *ngIf="phase() === 'test' && !isDemoTrial()">
              {{
                testMode() === TestMode.FreeRecall
                  ? (isSpatialTask() ? 'Touch each location!' : 'Touch each picture!')
                  : isSpatialTask()
                    ? 'Touch each location in order!'
                    : 'Touch each picture in order!'
              }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'test' && isDemoTrial()">
              {{ isSpatialTask() ? 'Watch each location in order.' : 'Watch each picture in order.' }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'test' && !isDemoTrial() && testMode() !== TestMode.FreeRecall">
              Step {{ pressed().length + 1 }} of {{ trialSequence().length }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'test' && !isDemoTrial() && testMode() === TestMode.FreeRecall">
              Response {{ pressed().length + 1 }} of {{ trialSequence().length }}
            </div>
            <div
              class="step-progress"
              *ngIf="
                phase() === 'test' &&
                testMode() !== TestMode.FreeRecall &&
                (feedbackStepNumber() || feedbackSmiley())
              "
            >
              <div
                class="step-badge"
                *ngFor="let _ of [].constructor(trialSequence().length); let i = index"
                [class.done]="i < pressed().length"
              >
                <span class="num" *ngIf="feedbackStepNumber()">{{ i + 1 }}</span>
                <span class="face" *ngIf="feedbackSmiley() && i < pressed().length">😊</span>
              </div>
            </div>
          </div>

          <div class="stage-grid-wrap">
          <div class="grid4">
            <button
              class="cell"
              *ngFor="let cell of gridCells"
              [class.active]="showBorderHighlight() && (isGridCellActive(cell) || isAutoHighlightCell(cell))"
              [class.border-flash]="showBorderHighlight() && isCellBorderFlashing(cell)"
              [class.dim]="isGridCellDim(cell)"
              [disabled]="isGridCellDisabled(cell)"
              (click)="onGridCellClick(cell)"
            >
              <div
                class="step-overlay"
                *ngIf="
                  phase() === 'test' &&
                  testMode() !== TestMode.FreeRecall &&
                  gridStepBadge(cell) &&
                  (feedbackStepNumber() || feedbackSmiley())
                "
              >
                <div class="step-overlay-cluster" aria-hidden="true">
                  <span class="step-num" *ngIf="feedbackStepNumber()" [class.badge-border]="feedbackBorder()">{{
                    gridStepBadge(cell)
                  }}</span>
                  <span class="step-face" *ngIf="feedbackSmiley()">😊</span>
                </div>
              </div>
              <ng-container *ngIf="showImageInGridCell(cell); else emptyCell">
                <div class="cell-media">
                  <img
                    class="pic"
                    [src]="picSrc(picIdInGridCell(cell))"
                    alt=""
                    draggable="false"
                    loading="eager"
                    decoding="async"
                  />
                </div>
              </ng-container>
              <ng-template #emptyCell>
                <div class="cell-empty" aria-hidden="true"></div>
              </ng-template>
            </button>
          </div>
          </div>

          <div class="feedback" *ngIf="feedback()">
            <div class="pill" [class.ok]="feedback() === 'correct'" [class.no]="feedback() === 'wrong'">
              {{ feedback() === 'correct' ? 'Correct!' : 'Try again' }}
            </div>
          </div>

          <button
            type="button"
            class="study-replay-fab"
            *ngIf="showStudyReplayFab()"
            (click)="teacherReplayStudy()"
          >
            Show study again
          </button>

        </section>

        <section class="card" *ngIf="screen() === 'results'">
          <h1>{{ sessionEndedEarly() ? 'Session ended early' : 'All finished!' }}</h1>
          <p class="muted">
            A backup is kept in this device’s browser storage until you download.
            <span *ngIf="sessionEndedEarly()"> Early Finish also saved any in-progress taps.</span>
            <span *ngIf="reportAutoDownloaded()"> An Excel download was started automatically.</span>
          </p>
          <div class="actions">
            <button class="btn ghost" (click)="goHomeFromResults()">New session</button>
            <button class="btn primary" [disabled]="results().length === 0" (click)="downloadReport()">
              Download Report
            </button>
          </div>
          <div class="mini">
            Saved: {{ results().length }} / {{ trials() }} trial(s)
            <span *ngIf="lastCheckpointAt()"> · backup {{ lastCheckpointLabel() }}</span>
          </div>
        </section>
      </main>

      <div
        class="picker-overlay run-prompt"
        *ngIf="screen() === 'run' && sequenceChangedPromptOpen()"
        (click)="dismissSequenceChangedPrompt()"
      >
        <div class="picker same-seq-prompt" (click)="$event.stopPropagation()">
          <div class="picker-top">
            <div class="picker-title">Sequence changed</div>
          </div>
          <p class="same-seq-prompt-copy">
            Trial {{ trialIndex() + 1 }} uses a new
            {{ isSpatialTask() ? 'location' : 'picture' }} sequence
            <b>({{ currentTrialSequenceLabel() }})</b>. The previous trial used a different sequence, so study will
            run before this trial.
          </p>
          <div class="same-seq-prompt-actions">
            <button class="btn primary" type="button" (click)="dismissSequenceChangedPrompt()">OK</button>
          </div>
        </div>
      </div>

      <div
        class="congrats"
        *ngIf="screen() === 'run' && showCongrats()"
        role="dialog"
        aria-live="polite"
        aria-label="Reward"
      >
        <div class="congrats-backdrop"></div>
        <div
          class="congrats-card"
          [class.congrats-card--correct]="activeRewardKind() === 'correct'"
          [class.congrats-card--surprise]="activeRewardKind() === 'surprise'"
          [attr.data-surprise]="activeSurpriseId()"
        >
          <div class="congrats-orbit" aria-hidden="true" *ngIf="activeRewardKind() !== 'correct'">
            <span class="orbit-item o1">✨</span>
            <span class="orbit-item o2">⭐</span>
            <span class="orbit-item o3">🎊</span>
            <span class="orbit-item o4">🌟</span>
            <span class="orbit-item o5">✨</span>
            <span class="orbit-item o6">🎉</span>
          </div>

          <!-- Audio/visual Correct -->
          <ng-container *ngIf="activeRewardKind() === 'correct'">
            <div class="congrats-hero">✅</div>
            <h2 class="congrats-title">Correct!</h2>
            <p class="congrats-sub">Nice work!</p>
          </ng-container>

          <!-- Kids / Surprise celebration video (track playId so each pick remounts the <video>) -->
          <ng-container *ngIf="activeRewardKind() === 'video' && activeRewardVideo() as clip">
            <div class="congrats-hero">🎉</div>
            <div class="congrats-video-wrap">
              <video
                *ngFor="let play of rewardVideoPlays(); trackBy: trackRewardPlay"
                class="congrats-video"
                [src]="play.src"
                autoplay
                muted
                playsinline
                preload="auto"
              ></video>
            </div>
            <h2 class="congrats-title">{{ clip.title }}</h2>
            <p class="congrats-sub">{{ clip.sub }}</p>
          </ng-container>

          <!-- Fallback CSS celebration (only if no video clip) -->
          <ng-container *ngIf="activeRewardKind() === 'surprise' && activeSurprise()">
            <div class="surprise-stage" [attr.data-id]="activeSurprise()!.id" aria-hidden="true">
              <span class="surprise-burst b1">{{ activeSurprise()!.burst }}</span>
              <span class="surprise-burst b2">{{ activeSurprise()!.burst }}</span>
              <span class="surprise-burst b3">{{ activeSurprise()!.burst }}</span>
              <div class="surprise-hero">{{ activeSurprise()!.emoji }}</div>
            </div>
            <h2 class="congrats-title">{{ activeSurprise()!.title }}</h2>
            <p class="congrats-sub">{{ activeSurprise()!.sub }}</p>
          </ng-container>
        </div>
      </div>
    </div>
  `,
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @HostBinding('class.run-active')
  get hostRunActive() {
    return this.screen() === 'run';
  }

  @HostBinding('class.desktop-app')
  get hostDesktopApp() {
    return this.isDesktopApp;
  }

  /** True when running inside the Electron desktop shell. */
  readonly isDesktopApp =
    typeof window !== 'undefined' && typeof window.selectDesktop?.closeApp === 'function';

  readonly TaskType = {
    Location: 'location',
    Picture: 'picture',
  } as const;

  readonly TestMode = {
    Standard: 'standard',
    FreeRecall: 'freeRecall',
    AdvanceWhenCorrect: 'advanceWhenCorrect',
  } as const;

  readonly RewardMode = {
    None: 'none',
    Correct: 'correct',
    Video: 'video',
  } as const;

  readonly VideoRewardStyle = {
    Kids: 'kids',
    Surprise: 'surprise',
  } as const;

  readonly screen = signal<'home' | 'setup' | 'run' | 'results'>('home');
  readonly taskType = signal<(typeof this.TaskType)[keyof typeof this.TaskType]>(this.TaskType.Location);

  // Session setup
  readonly subjectId = signal('kid001');
  readonly trials = signal(5);
  readonly totalTrialsNum = signal(5);
  readonly stepsNum = signal(2);
  readonly distractorsN = signal(0);
  readonly studySeconds = signal(1);
  readonly itiSeconds = signal(1);
  /** Correct-step feedback toggles (location + picture test). */
  readonly feedbackBorder = signal(true);
  readonly feedbackStepNumber = signal(true);
  readonly feedbackSmiley = signal(true);
  /** Sound + pill on first touch of each step. */
  readonly feedbackEveryResponse = signal(true);
  /** Sound + Try again on true wrong taps (never on same-item re-taps). */
  readonly feedbackEveryError = signal(true);
  /** Hide the cell/picture after a correct touch (Spatial and Object). */
  readonly disappearOnCorrect = signal(false);
  readonly testMode = signal<(typeof this.TestMode)[keyof typeof this.TestMode]>(
    this.TestMode.AdvanceWhenCorrect,
  );
  /** When true, one sequence row applies to every trial (trial 1 is the master). */
  readonly sameSequenceForAllTrials = signal(false);
  /** First N trials: computer highlights the answer; child watches (no taps). */
  readonly automaticDemo = signal(false);
  readonly demoTrials = signal(0);
  /** How long each ghost-demo item stays highlighted (seconds). */
  readonly demoStepSeconds = signal(2);
  readonly demoHighlightsPerStep = signal(1);

  /** End-of-trial reward (Spatial + Object, all modes; skipped on automatic demos). */
  readonly rewardMode = signal<(typeof this.RewardMode)[keyof typeof this.RewardMode]>(
    this.RewardMode.Video,
  );
  readonly videoRewardStyle = signal<(typeof this.VideoRewardStyle)[keyof typeof this.VideoRewardStyle]>(
    this.VideoRewardStyle.Kids,
  );
  readonly rewardSeconds = signal(3);
  /** True when the teacher stopped the session with Early Finish (results still downloadable). */
  readonly sessionEndedEarly = signal(false);
  /** Undownloaded backup from a previous run (home-screen recovery). */
  readonly pendingRecovery = signal<SessionCheckpoint | null>(null);
  readonly lastCheckpointAt = signal<number | null>(null);
  readonly reportAutoDownloaded = signal(false);
  readonly activeRewardKind = signal<'correct' | 'video' | 'surprise' | null>(null);
  private pageHideHandler: (() => void) | null = null;
  readonly activeRewardVideo = signal<RewardVideoClip | null>(null);
  /** Bumps each reward so the <video> element is destroyed/recreated (src changes alone often do not reload). */
  readonly rewardPlayNonce = signal(0);
  readonly rewardVideoPlays = computed(() => {
    const clip = this.activeRewardVideo();
    if (!clip) return [] as Array<RewardVideoClip & { playId: string }>;
    return [{ ...clip, playId: `${clip.id}-${this.rewardPlayNonce()}` }];
  });
  readonly activeSurprise = signal<(typeof SURPRISE_REWARDS)[number] | null>(null);
  readonly activeSurpriseId = computed(() => this.activeSurprise()?.id ?? '');
  /** Shuffle bags so Surprise (and Kids) cycle through all clips before repeating. */
  private rewardVideoBag: RewardVideoClip[] = [];
  private surpriseCssBag: (typeof SURPRISE_REWARDS)[number][] = [];
  private lastRewardVideoId: string | null = null;

  // Runtime
  readonly trialIndex = signal(0);
  readonly phase = signal<'study' | 'studyReady' | 'test' | 'done'>('study');
  /** Frozen target sequence for the active trial (prevents order drift mid-trial). */
  readonly trialSequence = signal<number[]>([]);
  /** Location test: which cells are visible this trial (set once when test starts). */
  readonly trialTestCells = signal<number[]>([]);
  readonly stepIndex = signal(0); // within-trial sequence step
  readonly countdown = signal(0);
  readonly pressed = signal<number[]>([]);
  readonly pressedOrder = signal<Array<{ cell: number; step: number }>>([]);
  /** Grid cells hidden after a correct touch when disappearOnCorrect is on. */
  readonly disappearedCells = signal<Set<number>>(new Set());
  readonly feedback = signal<'correct' | 'wrong' | null>(null);
  readonly showCongrats = signal(false);
  /** True after the teacher continues from study-ready into test for the current trial. */
  readonly sessionStudyDone = signal(false);
  /** Teacher replayed study mid-test; return to test without resetting the trial. */
  private studyReturnToTest = signal(false);
  /** Spatial task: one identical filler picture for the whole trial (study + test). */
  readonly locTrialPicId = signal(1);
  /** Picture task: random grid cell per study step (1–16). */
  readonly picStudyCellByStep = signal<number[]>([]);
  /** Picture task: test phase cell -> picture id. */
  readonly picTestCellToPic = signal<Record<number, number>>({});

  readonly gridCells = Array.from({ length: 16 }, (_, i) => i + 1);

  // A tiny built-in demo sequence plan (one line per trial)
  readonly locationSequences = signal<number[][]>(DEFAULT_LOCATION_ROWS.map((row) => [...row]));

  readonly pictureSequences = signal<number[][]>(DEFAULT_PICTURE_ROWS.map((row) => [...row]));

  /** Built-in 1..MAX_PIC_ID plus any in-app uploads (ids ≥ CUSTOM_PIC_START). */
  readonly customPicIds = signal<number[]>([]);
  readonly picUploadBusy = signal(false);
  private customPicUrlById = new Map<number, string>();
  readonly picIds = computed(() => [
    ...Array.from({ length: MAX_PIC_ID }, (_v, i) => i + 1),
    ...this.customPicIds(),
  ]);

  readonly results = signal<TrialResult[]>([]);

  /** Every tap during the active trial (including wrong, ignored, and automatic demo steps). */
  readonly trialTouches = signal<TrialTouch[]>([]);
  readonly automaticPlayback = signal(false);
  readonly autoHighlightCell = signal<number | null>(null);

  private trialStartedAt = 0;
  private sessionStartedAt = 0;
  private testPhaseStartedAt = 0;
  private trialSessionStartMs = 0;
  private sessionDate = new Date();
  private trialTapCount = 0;
  private trialWrongCount = 0;
  /** Prevents extra taps / double-recording while a trial is finishing. */
  private trialLocked = false;
  private timer: number | null = null;
  private congratsTimer: number | null = null;
  private advanceTimer: number | null = null;
  private activeAudio: HTMLAudioElement[] = [];
  private borderFlashTimers = new Map<number, number>();
  private autoDemoTimer: number | null = null;
  private autoDemoStartTimer: number | null = null;
  /** Bumped to cancel stale ghost-demo timeouts when starting the next trial. */
  private autoDemoGeneration = 0;
  /** Sequence keys that already had a non-demo teacher study this session. */
  private liveStudyShownKeys = new Set<string>();
  /** Grid cells showing a short-lived border after a tap (clears after ~2s). */
  readonly borderFlashCells = signal<Set<number>>(new Set());

  /**
   * Ghost demo when automatic is on and this trial’s sequence has had fewer than
   * `demoTrials` prior appearances (N is constant per unique sequence).
   */
  readonly isDemoTrial = computed(() => {
    if (!this.automaticDemo()) return false;
    const n = Math.max(0, Math.floor(this.demoTrials()));
    if (n <= 0) return false;
    // Touch sequence signals so the computed stays in sync with the editor.
    void this.taskType();
    void this.stepsNum();
    void this.locationSequences();
    void this.pictureSequences();
    const t = this.trialIndex();
    const key = this._sequenceKey(this._trialSequenceAt(t));
    let earlierSame = 0;
    for (let i = 0; i < t; i++) {
      if (this._sequenceKey(this._trialSequenceAt(i)) === key) earlierSame++;
    }
    return earlierSame < n;
  });

  /** Border on for user setting, or always during automatic watch playback (no sound there). */
  readonly showBorderHighlight = computed(() => this.feedbackBorder() || this.automaticPlayback());

  // Picture picker overlay (visual selection)
  readonly picPickerOpen = signal(false);
  readonly picPickerTrial = signal(0);
  readonly picPickerStep = signal(0);
  // Location picker overlay (4x4 grid selection)
  readonly locPickerOpen = signal(false);
  readonly locPickerTrial = signal(0);
  readonly locPickerStep = signal(0);
  readonly sameSequencePromptOpen = signal(false);
  private pendingStartAfterSameSequencePrompt = false;
  /** Per-trial sequences saved before "same sequence for all trials" overwrites them. */
  private perTrialSequenceSnapshot: number[][] | null = null;
  /** User chose not to enable same-sequence mode while all trials still match. */
  private declinedSameSequenceSuggestion = false;
  readonly sequenceValidationPromptOpen = signal(false);
  readonly sequenceValidationErrors = signal<string[]>([]);
  readonly sequenceChangedPromptOpen = signal(false);

  readonly expectedNext = computed(() => {
    const seq = this.trialSequence();
    const k = Math.min(this.pressed().length, seq.length - 1);
    return seq[k];
  });

  readonly pressedBadges = computed(() => {
    // Location task: map cell -> last completed step number (handles repeats by showing latest)
    const map: Record<number, number> = {};
    for (const p of this.pressedOrder()) map[p.cell] = p.step;
    return map;
  });

  /** Picture task: map picture id -> last completed step (same pressedOrder, cell holds pic id). */
  readonly pressedBadgesPic = computed(() => {
    const map: Record<number, number> = {};
    for (const p of this.pressedOrder()) map[p.cell] = p.step;
    return map;
  });

  readonly canStart = computed(() => {
    const okId = this.subjectId().trim().length >= 2;
    return okId && this.trials() >= 1 && this.stepsNum() >= 1 && this.studySeconds() >= 0;
  });

  constructor() {
    this._refreshPendingRecovery();
    this._installUnloadFlush();
    void this._loadCustomPics();

    // Ensure no timers leak between screens
    effect(() => {
      const s = this.screen();
      if (s !== 'run') {
        this._stopTimer();
        this._stopAutoDemo();
        this._stopAllAudio();
        this.picPickerOpen.set(false);
        this.locPickerOpen.set(false);
      }
    });

    // Keep per-trial sequence arrays in sync with Trials + StepsNum (setup only).
    effect(() => {
      if (this.screen() !== 'setup') return;
      const t = Math.max(1, Math.min(50, this.trials()));
      const task = this.taskType();
      const maxSteps = 16;
      const rawSteps = this.stepsNum();
      const steps = Math.max(1, Math.min(maxSteps, rawSteps));
      if (steps !== rawSteps) {
        untracked(() => this.stepsNum.set(steps));
      }
      const syncAll = this.sameSequenceForAllTrials();
      if (task === this.TaskType.Picture) {
        const cur = untracked(() => this.pictureSequences());
        let next = this._normalizeSequences(cur, t, steps, 1, this.maxPicId(), DEFAULT_PICTURE_ROWS);
        if (syncAll) next = this._syncAllTrialsToMaster(next);
        this.pictureSequences.set(next);
        untracked(() => this._maybePromptSameSequenceForAllTrials(false));
      } else {
        const cur = untracked(() => this.locationSequences());
        let next = this._normalizeSequences(cur, t, steps, 1, 16, DEFAULT_LOCATION_ROWS);
        if (syncAll) next = this._syncAllTrialsToMaster(next);
        this.locationSequences.set(next);
        untracked(() => this._maybePromptSameSequenceForAllTrials(false));
      }
    });
    this.setTestMode(this.testMode());
    effect(() => {
      if (this.screen() !== 'setup') return;
      const t = Math.max(1, this.trials());
      untracked(() => this.totalTrialsNum.set(t));
    });
  }

  setAutomaticDemo(on: boolean) {
    this.automaticDemo.set(on);
    // Enabling ghost demos with N=0 would never run; default to at least one watch trial.
    if (on && this.demoTrials() < 1) {
      this.demoTrials.set(1);
    }
    // Ghost watch replaces teacher study — keep study timer off so kids do not get two demos.
    if (on) {
      this.studySeconds.set(0);
    }
  }

  setDemoStepSeconds(raw: number) {
    const n = Number.isFinite(raw) ? raw : 2;
    // Keep watch pace readable for toddlers (1–5s per highlighted item).
    this.demoStepSeconds.set(Math.max(1, Math.min(5, Math.round(n * 2) / 2)));
  }

  setTestMode(mode: (typeof this.TestMode)[keyof typeof this.TestMode]) {
    this.testMode.set(mode);
    switch (mode) {
      case this.TestMode.Standard:
        this.feedbackBorder.set(true);
        this.feedbackStepNumber.set(false);
        this.feedbackSmiley.set(false);
        this.feedbackEveryResponse.set(true);
        this.feedbackEveryError.set(true);
        break;
      case this.TestMode.FreeRecall:
        this.feedbackBorder.set(true);
        this.feedbackStepNumber.set(false);
        this.feedbackSmiley.set(false);
        this.feedbackEveryResponse.set(true);
        this.feedbackEveryError.set(false);
        break;
      case this.TestMode.AdvanceWhenCorrect:
        this.feedbackBorder.set(false);
        this.feedbackStepNumber.set(false);
        this.feedbackSmiley.set(false);
        this.feedbackEveryResponse.set(true);
        this.feedbackEveryError.set(true);
        break;
    }
  }

  exitDesktopApp() {
    this._flushSessionForQuit();
    window.selectDesktop?.closeApp();
  }

  recoverySavedLabel() {
    const at = this.pendingRecovery()?.savedAt;
    if (!at) return '';
    try {
      return new Date(at).toLocaleString();
    } catch {
      return '';
    }
  }

  lastCheckpointLabel() {
    const at = this.lastCheckpointAt();
    if (!at) return '';
    try {
      return new Date(at).toLocaleTimeString();
    } catch {
      return '';
    }
  }

  downloadRecoveredReport() {
    const cp = this.pendingRecovery() ?? this._loadCheckpoint();
    if (!cp?.results?.length) return;
    this.subjectId.set(cp.subjectId || 'subject');
    this.taskType.set(cp.taskType);
    this.trials.set(Math.max(1, cp.trialsPlanned || cp.results.length));
    this.sessionEndedEarly.set(!!cp.sessionEndedEarly);
    this.sessionDate = new Date(cp.sessionDateIso || Date.now());
    this.results.set(cp.results);
    this.downloadReport();
    this._refreshPendingRecovery();
  }

  discardRecovery() {
    this._clearCheckpoint();
    this.pendingRecovery.set(null);
  }

  goHomeFromResults() {
    this._refreshPendingRecovery();
    this.screen.set('home');
  }

  goSetup(type: 'location' | 'picture') {
    this.taskType.set(type);
    this.sameSequenceForAllTrials.set(false);
    this.sameSequencePromptOpen.set(false);
    this.pendingStartAfterSameSequencePrompt = false;
    this.perTrialSequenceSnapshot = null;
    this.declinedSameSequenceSuggestion = false;
    this.sequenceValidationPromptOpen.set(false);
    this.sequenceValidationErrors.set([]);
    this.locationSequences.set(DEFAULT_LOCATION_ROWS.map((row) => [...row]));
    this.pictureSequences.set(DEFAULT_PICTURE_ROWS.map((row) => [...row]));
    this.screen.set('setup');
  }

  /** Leave study/test and return to setup without resetting programmed sequences. */
  returnToSetup() {
    if (this.screen() !== 'run' && this.screen() !== 'results') return;
    this._stopTimer();
    this._stopAutoDemo();
    this._stopAllAudio();
    // Keep a local backup before wiping in-memory results.
    this._captureInProgressTrialIfNeeded();
    if (this.results().length > 0) this._persistCheckpoint(false);
    this._resetSessionProgress();
    this.sessionEndedEarly.set(false);
    this._refreshPendingRecovery();
    this.screen.set('setup');
  }

  /**
   * Stop testing early (Spatial + Object, all modes).
   * Keeps every completed trial already in results, plus the current trial if any taps were recorded.
   * Goes to the results screen so the report can be downloaded.
   */
  finishEarly() {
    if (this.screen() !== 'run') return;

    this._stopTimer();
    this._stopAutoDemo();
    this._stopAllAudio();
    this._clearAdvanceTimer();
    if (this.congratsTimer != null) {
      window.clearTimeout(this.congratsTimer);
      this.congratsTimer = null;
    }
    this.showCongrats.set(false);
    this.activeRewardKind.set(null);
    this.activeSurprise.set(null);
    this.activeRewardVideo.set(null);
    this.feedback.set(null);
    this.automaticPlayback.set(false);
    this.autoHighlightCell.set(null);
    this.sequenceChangedPromptOpen.set(false);
    this._clearBorderFlashes();

    this._captureInProgressTrialIfNeeded();

    this.trialLocked = true;
    this.sessionEndedEarly.set(true);
    this.phase.set('done');
    this._persistCheckpoint(false);
    this.screen.set('results');
    this._autoDownloadReportIfPossible();
  }

  private _resetSessionProgress() {
    this.sessionEndedEarly.set(false);
    this.reportAutoDownloaded.set(false);
    this.lastCheckpointAt.set(null);
    this.results.set([]);
    this.trialIndex.set(0);
    this.stepIndex.set(0);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.disappearedCells.set(new Set());
    this.feedback.set(null);
    this.showCongrats.set(false);
    this.activeRewardKind.set(null);
    this.activeSurprise.set(null);
    this.activeRewardVideo.set(null);
    this._clearBorderFlashes();
    this.sessionStudyDone.set(false);
    this.sequenceChangedPromptOpen.set(false);
    this.studyReturnToTest.set(false);
    this.automaticPlayback.set(false);
    this.autoHighlightCell.set(null);
    this.locTrialPicId.set(1);
    this.picTestCellToPic.set({});
    this.picStudyCellByStep.set([]);
    this.trialTestCells.set([]);
    this.trialTouches.set([]);
    this.trialSequence.set([]);
    this.phase.set('study');
    this.countdown.set(0);
    this.trialTapCount = 0;
    this.trialWrongCount = 0;
    this.trialLocked = false;
    this.liveStudyShownKeys = new Set();
    this._clearAdvanceTimer();
    this._stopAutoDemo();
    if (this.congratsTimer != null) {
      window.clearTimeout(this.congratsTimer);
      this.congratsTimer = null;
    }
  }

  taskTitle() {
    return this.isSpatialTask() ? 'Spatial Task' : 'Object Task';
  }

  taskTagline() {
    return this.isSpatialTask() ? 'Remember locations' : 'Remember pictures';
  }

  isSpatialTask() {
    return this.taskType() === this.TaskType.Location;
  }

  maxStepsNum() {
    return 16;
  }

  setStepsNum(raw: number) {
    const max = this.maxStepsNum();
    this.stepsNum.set(Math.max(1, Math.min(max, Number(raw) || 1)));
  }

  seqTableCols() {
    return this.sameSequenceForAllTrials() ? this.stepsNum() + 1 : this.stepsNum() + 2;
  }

  /** Equal-width trial/copy/step columns when the table is still easy to read. */
  useEqualSeqColumns() {
    return this.stepsNum() <= 6;
  }

  setSameSequenceForAllTrials(on: boolean) {
    if (on) {
      this.declinedSameSequenceSuggestion = false;
      this._snapshotPerTrialSequences();
      this.sameSequenceForAllTrials.set(true);
      this.applySequenceToAllTrials();
      return;
    }
    this.declinedSameSequenceSuggestion = true;
    this.sameSequenceForAllTrials.set(false);
    this.sameSequencePromptOpen.set(false);
    this.pendingStartAfterSameSequencePrompt = false;
    this._restorePerTrialSequencesFromSnapshot();
  }

  private _snapshotPerTrialSequences() {
    const t = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    this.perTrialSequenceSnapshot = this._setupSequences()
      .slice(0, t)
      .map((row) => row.slice(0, steps).map((v) => v));
  }

  private _restorePerTrialSequencesFromSnapshot() {
    const t = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    const isPicture = this.taskType() === this.TaskType.Picture;
    const seed = isPicture ? DEFAULT_PICTURE_ROWS : DEFAULT_LOCATION_ROWS;
    const source =
      this.perTrialSequenceSnapshot?.length ? this.perTrialSequenceSnapshot : seed.map((row) => [...row]);
    const next = this._normalizeSequences(
      source,
      t,
      steps,
      1,
      isPicture ? this.maxPicId() : 16,
      seed,
    );
    if (isPicture) this.pictureSequences.set(next);
    else this.locationSequences.set(next);
  }

  applySequenceToAllTrials() {
    if (this.taskType() === this.TaskType.Picture) {
      const t = Math.max(1, this.trials());
      const steps = Math.max(1, this.stepsNum());
      const next = this._syncAllTrialsToMaster(
        this._normalizeSequences(this.pictureSequences(), t, steps, 1, this.maxPicId(), DEFAULT_PICTURE_ROWS),
      );
      this.pictureSequences.set(next);
    } else {
      const t = Math.max(1, this.trials());
      const steps = Math.max(1, this.stepsNum());
      const next = this._syncAllTrialsToMaster(
        this._normalizeSequences(this.locationSequences(), t, steps, 1, 16, DEFAULT_LOCATION_ROWS),
      );
      this.locationSequences.set(next);
    }
    this._maybePromptSameSequenceForAllTrials(false);
  }

  copyPreviousTrialSequence(trialIdx: number) {
    if (trialIdx < 1 || this.sameSequenceForAllTrials()) return;
    const t = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    const isPicture = this.taskType() === this.TaskType.Picture;
    const seed = isPicture ? DEFAULT_PICTURE_ROWS : DEFAULT_LOCATION_ROWS;
    const cur = isPicture ? this.pictureSequences() : this.locationSequences();
    const normalized = this._normalizeSequences(cur, t, steps, 1, isPicture ? this.maxPicId() : 16, seed);
    const copied = [...normalized[trialIdx - 1]];
    const next = normalized.map((row, i) => (i === trialIdx ? copied : [...row]));
    if (isPicture) this.pictureSequences.set(next);
    else this.locationSequences.set(next);
    this._onTrialSequencesChanged();
  }

  declineSameSequencePrompt() {
    this.sameSequencePromptOpen.set(false);
    this.declinedSameSequenceSuggestion = true;
    this.pendingStartAfterSameSequencePrompt = false;
  }

  acceptSameSequencePrompt() {
    this.sameSequencePromptOpen.set(false);
    this.declinedSameSequenceSuggestion = false;
    const pendingStart = this.pendingStartAfterSameSequencePrompt;
    this.pendingStartAfterSameSequencePrompt = false;
    if (!this.sameSequenceForAllTrials()) {
      this.setSameSequenceForAllTrials(true);
    }
    if (pendingStart && this._passesSequenceValidation()) {
      this._startSession();
    }
  }

  private _onTrialSequencesChanged() {
    if (!this._allTrialSequencesMatch()) {
      this.declinedSameSequenceSuggestion = false;
    }
    this._maybePromptSameSequenceForAllTrials(false);
  }

  dismissSameSequencePrompt() {
    this.declineSameSequencePrompt();
  }

  dismissSequenceValidationPrompt() {
    this.sequenceValidationPromptOpen.set(false);
  }

  private _passesSequenceValidation() {
    const errors = this._collectSequenceValidationErrors();
    if (!errors.length) return true;
    this.sequenceValidationErrors.set(errors);
    this.sequenceValidationPromptOpen.set(true);
    return false;
  }

  private _collectSequenceValidationErrors() {
    const trials = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    const isSpatial = this.isSpatialTask();
    const rows = this._setupSequences()
      .slice(0, trials)
      .map((row) => row.slice(0, steps));
    const errors: string[] = [];
    const syncAll = this.sameSequenceForAllTrials();

    for (let i = 0; i < rows.length; i++) {
      if (syncAll && i > 0) continue;
      const row = rows[i];
      const trialLabel = syncAll ? 'All trials' : `Trial ${i + 1}`;
      const byValue = new Map<number, number[]>();
      for (let s = 0; s < row.length; s++) {
        const value = row[s];
        const stepsForValue = byValue.get(value) ?? [];
        stepsForValue.push(s + 1);
        byValue.set(value, stepsForValue);
      }
      for (const [value, stepNums] of byValue) {
        if (stepNums.length < 2) continue;
        const label = isSpatial ? `Cell ${value}` : `Picture ${this.pad3(value)}`;
        const stepList = stepNums.join(', ');
        errors.push(
          `${trialLabel}: ${label} is used in steps ${stepList}. Each step must use a different ${isSpatial ? 'cell' : 'picture'}.`,
        );
      }
    }
    return errors;
  }

  private _setupSequences() {
    return this.taskType() === this.TaskType.Location ? this.locationSequences() : this.pictureSequences();
  }

  private _allTrialSequencesMatch() {
    const trials = Math.max(1, this.trials());
    if (trials <= 1) return false;
    const steps = Math.max(1, this.stepsNum());
    const rows = this._setupSequences()
      .slice(0, trials)
      .map((row) => row.slice(0, steps));
    if (rows.length < 2) return false;
    const key = JSON.stringify(rows[0]);
    return rows.every((row) => JSON.stringify(row) === key);
  }

  private _maybePromptSameSequenceForAllTrials(pendingStart: boolean) {
    if (this.screen() !== 'setup') return;
    if (this.declinedSameSequenceSuggestion) return;
    if (this.sameSequenceForAllTrials() || !this._allTrialSequencesMatch()) return;
    this.pendingStartAfterSameSequencePrompt = pendingStart;
    this.sameSequencePromptOpen.set(true);
  }

  private _syncAllTrialsToMaster(seqs: number[][]) {
    if (!seqs.length) return seqs;
    const master = [...seqs[0]];
    return seqs.map(() => [...master]);
  }

  start() {
    if (!this.canStart()) return;
    if (!this._passesSequenceValidation()) return;
    if (!this.sameSequenceForAllTrials() && this._allTrialSequencesMatch()) {
      this._maybePromptSameSequenceForAllTrials(true);
      return;
    }
    this._startSession();
  }

  private _startSession() {
    if (!this.canStart()) return;
    this._resetSessionProgress();
    this.sessionDate = new Date();
    this.sessionStartedAt = performance.now();
    this.totalTrialsNum.set(this.trials());
    void this._preloadSessionAssets();
    this._beginTrial();
    this.trialStartedAt = performance.now();
    this.screen.set('run');
    this._startTrialPhaseAfterSetup();
  }

  dismissSequenceChangedPrompt() {
    this.sequenceChangedPromptOpen.set(false);
    this._startTeacherStudyForCurrentTrial();
  }

  currentTrialSequenceLabel() {
    const seq = this.trialSequence();
    if (this.isSpatialTask()) {
      return seq.map((cell) => `Cell ${cell}`).join(' → ');
    }
    return seq.map((id) => this.pad3(id)).join(' → ');
  }

  private _trialSequenceAt(trialIdx: number) {
    const seqs =
      this.taskType() === this.TaskType.Location ? this.locationSequences() : this.pictureSequences();
    const row = seqs[Math.min(trialIdx, seqs.length - 1)] ?? [];
    return (row.length ? row : [1]).slice(0, Math.max(1, this.stepsNum()));
  }

  private _sequenceKey(seq: number[]) {
    return JSON.stringify(seq);
  }

  private _sequenceMatchesPreviousTrial(trialIdx: number) {
    if (trialIdx <= 0) return false;
    return (
      this._sequenceKey(this._trialSequenceAt(trialIdx)) ===
      this._sequenceKey(this._trialSequenceAt(trialIdx - 1))
    );
  }

  private _needsSequenceChangePrompt() {
    if (this.sameSequenceForAllTrials() || this.isDemoTrial()) return false;
    const t = this.trialIndex();
    if (t <= 0) return false;
    return !this._sequenceMatchesPreviousTrial(t);
  }

  private _startTrialPhaseAfterSetup() {
    if (this._shouldSkipTeacherStudy()) {
      this._enterTestPhase();
      return;
    }
    if (this._needsSequenceChangePrompt()) {
      this.sequenceChangedPromptOpen.set(true);
      return;
    }
    this._startTeacherStudyForCurrentTrial();
  }

  private _startTeacherStudyForCurrentTrial() {
    this.sessionStudyDone.set(false);
    if (!this.isDemoTrial()) {
      this._markLiveStudyShownForCurrentSequence();
    }
    // 0 = skip study entirely (both tasks, all modes) — no sequence flash.
    if (Math.max(0, this.studySeconds()) <= 0) {
      this._finishStudyWithoutDisplay();
      return;
    }
    this.phase.set('study');
    this.countdown.set(this.studySeconds());
    this._runStudyTick();
  }

  replayStudy() {
    if (this.phase() !== 'studyReady') return;
    this._startStudyPlayback();
  }

  teacherReplayStudy() {
    if (!this.showStudyReplayFab()) return;
    this.studyReturnToTest.set(true);
    this._startStudyPlayback();
  }

  showStudyReplayFab() {
    return (
      this.phase() === 'test' &&
      !this.showCongrats() &&
      !this.automaticPlayback() &&
      !this.isDemoTrial()
    );
  }

  continueToTest() {
    if (this.phase() !== 'studyReady') return;
    this.sessionStudyDone.set(true);
    if (!this.isDemoTrial()) {
      this._markLiveStudyShownForCurrentSequence();
    }
    this._enterTestPhase();
  }

  private _startStudyPlayback() {
    this._stopTimer();
    this.stepIndex.set(0);
    this.phase.set('study');
    this.feedback.set(null);
    if (this.taskType() === this.TaskType.Picture) {
      this._buildPicStudyLayout();
    }
    // Manual "Show study again": if timer is 0, use a short default so the teacher can still preview.
    this._runStudyTick(Math.max(0, this.studySeconds()) || 2);
  }

  private _beginTrial() {
    const t = this.trialIndex();
    const seqs =
      this.taskType() === this.TaskType.Location ? this.locationSequences() : this.pictureSequences();
    const row = seqs[Math.min(t, seqs.length - 1)] ?? [];
    const seq = (row.length ? row : [1]).slice(0, Math.max(1, this.stepsNum()));
    this.trialSequence.set([...seq]);
    this.picTestCellToPic.set({});
    this.trialTestCells.set([]);
    if (this.taskType() === this.TaskType.Picture) {
      this._buildPicStudyLayout();
    } else {
      this.picStudyCellByStep.set([]);
      this._buildLocTrialPic();
    }
  }

  private _enterTestPhase() {
    this.phase.set('test');
    this.stepIndex.set(0);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.disappearedCells.set(new Set());
    this.feedback.set(null);
    this.trialLocked = false;
    if (this.taskType() === this.TaskType.Location) {
      this.trialTestCells.set(this._buildLocationTestCells());
    } else {
      this._buildPicTestLayout();
    }
    this.trialTapCount = 0;
    this.trialWrongCount = 0;
    this.trialTouches.set([]);
    this.testPhaseStartedAt = performance.now();
    this.trialSessionStartMs = Math.max(0, Math.round(this.testPhaseStartedAt - this.sessionStartedAt));
    this._clearBorderFlashes();
    this._stopTimer();
    if (this.isDemoTrial()) {
      // Always rebuild mapping right before scheduling so the next ghost demo is not empty.
      this._ensureDemoLayoutReady();
      // Lock input + show “Watch!” for the whole demo trial (including the start pause).
      this.automaticPlayback.set(true);
      this.autoHighlightCell.set(null);
      if (this.autoDemoStartTimer != null) window.clearTimeout(this.autoDemoStartTimer);
      // Brief pause so “Watch!” is readable before the first highlight.
      this.autoDemoStartTimer = window.setTimeout(() => {
        this.autoDemoStartTimer = null;
        this._runAutomaticDemo();
      }, 1200);
      return;
    }
  }

  /**
   * Timed study step. Pass `secondsPerItem` for manual replay overrides.
   * When seconds is 0, never paint the sequence (avoids a one-frame flash).
   */
  private _runStudyTick(secondsPerItem?: number) {
    this._stopTimer();
    const secs = Math.max(0, secondsPerItem ?? this.studySeconds());
    if (secs <= 0) {
      this._finishStudyWithoutDisplay();
      return;
    }

    this.phase.set('study');
    this.feedback.set(null);
    this.countdown.set(secs);

    const tick = () => {
      const left = this.countdown();
      if (left <= 1) {
        this.countdown.set(0);
        window.setTimeout(() => this._advanceStudyOrTest(secs), 250);
        return;
      }
      this.countdown.set(left - 1);
      this.timer = window.setTimeout(tick, 1000);
    };

    this.timer = window.setTimeout(tick, 1000);
  }

  /** End teacher study without showing any sequence step on the grid. */
  private _finishStudyWithoutDisplay() {
    this._stopTimer();
    this.stepIndex.set(0);
    this.countdown.set(0);
    this.feedback.set(null);
    if (this.studyReturnToTest()) {
      this.studyReturnToTest.set(false);
      this.phase.set('test');
      return;
    }
    this.phase.set('studyReady');
  }

  private _advanceStudyOrTest(secondsPerItem?: number) {
    const step = this.stepIndex();
    const seq = this.trialSequence();
    const secs = Math.max(0, secondsPerItem ?? this.studySeconds());
    if (step + 1 < seq.length) {
      this.stepIndex.set(step + 1);
      this._runStudyTick(secs);
      return;
    }
    this._finishStudyWithoutDisplay();
  }

  onPick(choice: number, tappedCell: number) {
    if (this.phase() !== 'test' || this.automaticPlayback() || this.isDemoTrial() || this.trialLocked) return;
    this._handleTestTap(Number(choice), tappedCell);
  }

  private _handleTestTap(choiceId: number, tappedCell: number) {
    if (this.trialLocked) return;

    const expected = Number(this.expectedNext());
    const presses = this.pressed();
    const seq = this.trialSequence();
    const isFreeRecall = this.testMode() === this.TestMode.FreeRecall;
    // Re-tap of an already-selected item: never an error (A/B/C, both tasks).
    const isRepeat = presses.includes(choiceId);
    // Free recall: a tap is "good" if it is still a needed target (any order).
    // Standard / Advance when correct: must match the next item in order.
    const ok = isFreeRecall
      ? !isRepeat && seq.some((id) => Number(id) === choiceId)
      : !isRepeat && choiceId === expected;

    // Always record every tap (Spatial and Object share this path).
    this._appendTouch({
      press: this.trialTouches().length + 1,
      ms: this._touchElapsedMs(),
      choice: choiceId,
      gridCell: tappedCell,
      expected,
      correct: ok || isRepeat, // repeats are never scored as errors
      repeat: isRepeat,
      ignored: false,
      automatic: false,
    });

    this.trialTapCount++;

    // Repeat: record only — silent, never ends the trial, no feedback.
    if (isRepeat) return;

    this._applyTapFeedback(ok, isFreeRecall, tappedCell);

    if (!ok && this.testMode() === this.TestMode.Standard) {
      this.trialWrongCount++;
      this._failTrialAndAdvance();
      return;
    }

    // --- Free recall: unlimited attempts until all targets found (any order) ---
    // Both tasks. Wrong/distractor taps are logged + feedback, but do not end the trial.
    // Contrast: Advance when correct requires the sequence in order.
    if (isFreeRecall) {
      if (!ok) {
        this.trialWrongCount++;
        return;
      }
      const next = [...presses, choiceId];
      this.pressed.set(next);
      this.pressedOrder.set([...this.pressedOrder(), { cell: choiceId, step: next.length }]);
      if (this.disappearOnCorrect()) {
        this._hideCellAfterCorrect(tappedCell);
      }
      if (this._isFreeRecallCorrect(next)) {
        this._completeTrial(next);
      }
      return;
    }

    // Standard + Advance when correct: only correct-in-order advances the step list.
    if (!ok) {
      this.trialWrongCount++;
      return;
    }

    const next = [...presses, choiceId];
    this.pressed.set(next);
    this.pressedOrder.set([...this.pressedOrder(), { cell: choiceId, step: next.length }]);
    if (this.disappearOnCorrect()) {
      this._hideCellAfterCorrect(tappedCell);
    }
    if (this._isSequenceComplete(next)) {
      this._completeTrial(next);
    }
  }

  private _hideCellAfterCorrect(cell: number) {
    const next = new Set(this.disappearedCells());
    next.add(cell);
    this.disappearedCells.set(next);
  }

  /**
   * Feedback for the first touch of a step only (repeats are handled above and stay silent).
   * - Every response ON → feedback on that first tap; OFF → no response feedback, ever.
   * - Every wrong tap ON → error cue on true mistakes; OFF → no error cue, ever.
   * Same rules for Spatial and Object tasks.
   */
  private _applyTapFeedback(ok: boolean, isFreeRecall: boolean, tappedCell: number) {
    if (ok) {
      if (!this.feedbackEveryResponse()) return;
      if (this.feedbackBorder()) this._flashCellBorder(tappedCell);
      if (isFreeRecall) {
        this._play('neutral');
        return;
      }
      this.feedback.set('correct');
      this._play('correct');
      window.setTimeout(() => this.feedback.set(null), 450);
      return;
    }

    // True wrong tap (not a repeat of an already-correct item)
    if (this.feedbackEveryError()) {
      if (this.feedbackBorder()) this._flashCellBorder(tappedCell);
      this.feedback.set('wrong');
      this._play('wrong');
      window.setTimeout(() => this.feedback.set(null), 450);
      return;
    }

    // Every response on but every-wrong off: non-error feedback only (no Try again / wrong sound).
    if (this.feedbackEveryResponse()) {
      if (this.feedbackBorder()) this._flashCellBorder(tappedCell);
      if (isFreeRecall) this._play('neutral');
    }
  }

  /** Exact in-order match (Standard / Advance when correct success). */
  private _isSequenceComplete(presses: number[]) {
    const seq = this.trialSequence();
    return presses.length === seq.length && presses.every((value, index) => Number(value) === Number(seq[index]));
  }

  /**
   * Free recall complete/success: every sequence target has been found (any order).
   * `presses` only stores newly found targets (wrong taps are not added).
   */
  private _isFreeRecallCorrect(presses: number[]) {
    const seq = this.trialSequence().map(Number);
    if (presses.length !== seq.length) return false;
    const need = [...seq].sort((a, b) => a - b);
    const got = presses.map(Number).sort((a, b) => a - b);
    return need.every((v, i) => v === got[i]);
  }

  private _appendTouch(touch: TrialTouch) {
    this.trialTouches.set([...this.trialTouches(), touch]);
  }

  private _completeTrial(presses: number[]) {
    if (this.trialLocked) return;
    this.trialLocked = true;
    this._hideTestGrid();

    const ms = Math.max(0, Math.round(performance.now() - this.trialStartedAt));
    const correct =
      this.testMode() === this.TestMode.FreeRecall
        ? this._isFreeRecallCorrect(presses)
        : this._isSequenceComplete(presses);
    const isDemo = this.isDemoTrial();
    this._recordTrialResult(presses, correct, ms, isDemo);

    // Only a correct-in-order sequence earns a reward; otherwise advance quietly.
    if (!correct) {
      this._scheduleAdvance(700);
      return;
    }

    // Watch demos: advance quietly without the live-trial reward.
    if (isDemo) {
      this._stopAutoDemo();
      this._scheduleAdvance(1500);
      return;
    }

    this._playRewardThenAdvance();
  }

  setRewardSeconds(raw: number) {
    const n = Number.isFinite(raw) ? raw : 3;
    this.rewardSeconds.set(Math.max(1, Math.min(5, Math.round(n))));
  }

  /** Play configured reward (or skip), then advance. Same for Spatial and Object. */
  private _playRewardThenAdvance() {
    const mode = this.rewardMode();
    if (mode === this.RewardMode.None) {
      this._scheduleAdvance(350);
      return;
    }

    const ms = Math.max(1, Math.min(5, this.rewardSeconds())) * 1000;

    if (mode === this.RewardMode.Correct) {
      this._play('correct');
      this._showReward('correct', null, null, ms);
      this._scheduleAdvance(ms + 120);
      return;
    }

    // Video reward — kid-friendly celebration clips + cheer music
    // Surprise: mostly rotating video clips; occasional CSS celebration for variety.
    if (this.videoRewardStyle() === this.VideoRewardStyle.Surprise && Math.random() < 0.15) {
      this._showReward('surprise', this._pickSurpriseCss(), null, ms);
    } else {
      const clip = this._pickRewardVideo();
      if (clip) {
        this._showReward('video', null, clip, ms);
      } else {
        this._showReward('surprise', this._pickSurpriseCss(), null, ms);
      }
    }
    this._play('success');
    this._scheduleAdvance(ms + 120);
  }

  trackRewardPlay(_: number, play: { playId: string }) {
    return play.playId;
  }

  /**
   * Draw the next reward clip from a shuffled bag (no immediate repeat).
   * Ensures Surprise cycles through every clip before any repeats.
   */
  private _pickRewardVideo(): RewardVideoClip | null {
    if (!REWARD_VIDEOS.length) return null;
    if (this.rewardVideoBag.length === 0) {
      this.rewardVideoBag = this._shuffledRewardVideos();
      // Avoid starting a fresh bag on the same clip we just showed.
      if (
        this.rewardVideoBag.length > 1 &&
        this.lastRewardVideoId &&
        this.rewardVideoBag[0]?.id === this.lastRewardVideoId
      ) {
        const first = this.rewardVideoBag.shift()!;
        this.rewardVideoBag.push(first);
      }
    }
    const clip = this.rewardVideoBag.shift() ?? null;
    if (clip) this.lastRewardVideoId = clip.id;
    return clip;
  }

  private _pickSurpriseCss(): (typeof SURPRISE_REWARDS)[number] {
    if (this.surpriseCssBag.length === 0) {
      this.surpriseCssBag = [...SURPRISE_REWARDS].sort(() => Math.random() - 0.5);
    }
    return this.surpriseCssBag.shift() ?? SURPRISE_REWARDS[0]!;
  }

  private _shuffledRewardVideos(): RewardVideoClip[] {
    const bag = [...REWARD_VIDEOS];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = bag[i]!;
      bag[i] = bag[j]!;
      bag[j] = tmp;
    }
    return bag;
  }

  private _showReward(
    kind: 'correct' | 'video' | 'surprise',
    surprise: (typeof SURPRISE_REWARDS)[number] | null,
    video: RewardVideoClip | null,
    visibleMs: number,
  ) {
    this.activeRewardKind.set(kind);
    this.activeSurprise.set(surprise);
    this.activeRewardVideo.set(video);
    if (video) this.rewardPlayNonce.update((n) => n + 1);
    this.showCongrats.set(true);
    if (this.congratsTimer != null) window.clearTimeout(this.congratsTimer);
    this.congratsTimer = window.setTimeout(() => {
      this.showCongrats.set(false);
      this.activeRewardKind.set(null);
      this.activeSurprise.set(null);
      this.activeRewardVideo.set(null);
      this.congratsTimer = null;
    }, visibleMs);
  }

  private _failTrialAndAdvance() {
    if (this.trialLocked) return;
    this.trialLocked = true;
    const presses = this.pressed();
    const ms = Math.max(0, Math.round(performance.now() - this.trialStartedAt));
    this._recordTrialResult(presses, false, ms, this.isDemoTrial());
    this._hideTestGrid();
    this._scheduleAdvance(700);
  }

  private _scheduleAdvance(delayMs: number) {
    this._clearAdvanceTimer();
    this.advanceTimer = window.setTimeout(() => {
      this.advanceTimer = null;
      this._nextTrialOrDone();
    }, delayMs);
  }

  private _clearAdvanceTimer() {
    if (this.advanceTimer != null) {
      window.clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  private _recordTrialResult(presses: number[], correct: boolean, ms: number, isDemo: boolean) {
    const sequence = [...this.trialSequence()];
    const taskType = this.taskType();
    const trialIdx = this.trialIndex();
    // Guard against double-record for the same trial index.
    if (this.results().some((r) => r.trial === trialIdx + 1)) return;

    this.results.set([
      ...this.results(),
      {
        trial: trialIdx + 1,
        taskType,
        testMode: this.testMode(),
        isDemo,
        sequence,
        presses,
        touches: [...this.trialTouches()],
        correct,
        ms,
        trialSessionStartMs: this.trialSessionStartMs,
        locTrialPic: taskType === this.TaskType.Location ? this.locTrialPicId() : undefined,
        report: this._buildTrialReportMeta(trialIdx, taskType, sequence),
      },
    ]);
    // Checkpoint after every completed trial so a crash mid-session does not lose data.
    this._persistCheckpoint(false);
  }

  private _buildTrialReportMeta(
    trialIndex: number,
    taskType: 'location' | 'picture',
    sequence: number[],
  ): TrialReportMeta {
    const trialsNum = Math.max(1, this.trials());
    const testMode = this.testMode();
    return {
      trialInList: (trialIndex % trialsNum) + 1,
      listNum: Math.floor(trialIndex / trialsNum) + 1,
      trialsNum,
      totalTrialsNum: Math.max(1, this.totalTrialsNum()),
      stepsNum: Math.max(1, this.stepsNum()),
      studySeconds: Math.max(0, this.studySeconds()),
      itiSeconds: Math.max(1, this.itiSeconds()),
      distractorsN: Math.max(0, this.distractorsN()),
      feedbackBorder: this.feedbackBorder(),
      freeRecall: testMode === this.TestMode.FreeRecall,
      progressCorrectOnly: testMode === this.TestMode.AdvanceWhenCorrect,
      playSound: true,
      listPics: this._legacyListPicsForTrial(taskType, sequence),
      listLocations: this._legacyListLocationsForTrial(taskType, sequence),
    };
  }

  private _runAutomaticDemo() {
    if (this.phase() !== 'test' || !this.isDemoTrial() || this.trialLocked) return;

    // Cancel any leftover timers from a previous ghost demo (fixes missing 2nd+ demo).
    if (this.autoDemoTimer != null) {
      window.clearTimeout(this.autoDemoTimer);
      this.autoDemoTimer = null;
    }
    const gen = ++this.autoDemoGeneration;

    // Ensure every sequence item has a visible cell before highlighting (Spatial + Object).
    this._ensureDemoLayoutReady();

    const seq = this.trialSequence().map((id) => Number(id));
    if (!seq.length) {
      this._completeTrial([]);
      return;
    }

    const highlightsPerStep = Math.max(1, Math.min(16, this.demoHighlightsPerStep()));
    this.automaticPlayback.set(true);
    this.autoHighlightCell.set(null);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.disappearedCells.set(new Set());
    this.feedback.set(null);
    this._clearBorderFlashes();

    let step = 0;
    let repeatIndex = 0;
    let layoutRetries = 0;
    // Automatic watch never uses the study timer — paced for toddlers to follow.
    const stepMs = Math.round(Math.max(1, Math.min(5, this.demoStepSeconds())) * 1000);
    const gapMs = Math.max(700, Math.round(stepMs * 0.4));

    const finishDemo = () => {
      if (gen !== this.autoDemoGeneration) return;
      if (this.autoDemoTimer != null) {
        window.clearTimeout(this.autoDemoTimer);
        this.autoDemoTimer = null;
      }
      // Keep “Watch!” / input lock until the trial advances.
      this.autoHighlightCell.set(null);
      const presses = [...seq];
      this.pressed.set(presses);
      this.pressedOrder.set(presses.map((cell, index) => ({ cell, step: index + 1 })));
      // Short beat after the last item before ending the watch trial.
      this.autoDemoTimer = window.setTimeout(() => {
        this.autoDemoTimer = null;
        if (gen !== this.autoDemoGeneration) return;
        this._completeTrial(presses);
      }, Math.max(800, gapMs));
    };

    const playHighlight = () => {
      if (gen !== this.autoDemoGeneration) return;
      if (this.trialLocked || this.phase() !== 'test' || !this.isDemoTrial()) return;

      if (step >= seq.length) {
        finishDemo();
        return;
      }

      const item = seq[step]!;
      let cell = this._gridCellForItem(item);
      if (cell == null && layoutRetries < 2) {
        layoutRetries++;
        this._ensureDemoLayoutReady();
        cell = this._gridCellForItem(item);
      }
      if (cell == null) {
        // Still missing — skip this step rather than hanging the session.
        step++;
        repeatIndex = 0;
        playHighlight();
        return;
      }

      this.autoHighlightCell.set(cell);
      this._flashCellBorder(cell, stepMs);
      this._playAutomaticStepSound();

      // Record one exportable press per sequence step (extra highlight flashes are UI-only).
      // Also advance pressed/pressedOrder so Step# / smiley feedback mirrors a live trial.
      if (repeatIndex === 0) {
        this._appendTouch({
          press: this.trialTouches().length + 1,
          ms: this._touchElapsedMs(),
          choice: item,
          gridCell: cell,
          expected: item,
          correct: true,
          repeat: false,
          ignored: false,
          automatic: true,
        });
        const nextPressed = [...this.pressed(), item];
        this.pressed.set(nextPressed);
        this.pressedOrder.set([
          ...this.pressedOrder(),
          { cell: item, step: nextPressed.length },
        ]);
      }

      repeatIndex++;
      const doneWithStep = repeatIndex >= highlightsPerStep;

      this.autoDemoTimer = window.setTimeout(() => {
        if (gen !== this.autoDemoGeneration) return;
        this.autoHighlightCell.set(null);
        this.autoDemoTimer = window.setTimeout(() => {
          if (gen !== this.autoDemoGeneration) return;
          if (doneWithStep) {
            step++;
            repeatIndex = 0;
          }
          playHighlight();
        }, gapMs);
      }, stepMs);
    };

    playHighlight();
  }

  /** Rebuild test grid mapping so ghost highlights always have a cell to flash. */
  private _ensureDemoLayoutReady() {
    if (this.taskType() === this.TaskType.Location) {
      const cells = this._buildLocationTestCells();
      this.trialTestCells.set(cells);
      if (!this.locTrialPicId()) this._buildLocTrialPic();
    } else {
      this._buildPicTestLayout();
    }
  }

  private _gridCellForItem(item: number): number | null {
    if (this.taskType() === this.TaskType.Location) {
      const cells = this.trialTestCells();
      return cells.map(Number).includes(Number(item)) ? Number(item) : null;
    }
    const map = this.picTestCellToPic();
    for (const [cellKey, picId] of Object.entries(map)) {
      if (Number(picId) === Number(item)) return Number(cellKey);
    }
    return null;
  }

  private _stopAutoDemo() {
    this.autoDemoGeneration++;
    if (this.autoDemoTimer != null) {
      window.clearTimeout(this.autoDemoTimer);
      this.autoDemoTimer = null;
    }
    if (this.autoDemoStartTimer != null) {
      window.clearTimeout(this.autoDemoStartTimer);
      this.autoDemoStartTimer = null;
    }
    this.automaticPlayback.set(false);
    this.autoHighlightCell.set(null);
  }

  private _hideTestGrid() {
    this.locTrialPicId.set(1);
    this.picTestCellToPic.set({});
    this.trialTestCells.set([]);
  }

  private _legacyExpectedAtProgress(sequence: number[], correctBefore: number) {
    return sequence[Math.min(correctBefore, Math.max(0, sequence.length - 1))];
  }

  /**
   * Label a tap by its place in the trial sequence (A = 1st target, B = 2nd, …).
   * Same for Spatial and Object. Distractors / unknown items are "X".
   * Example: sequence [13, 6], taps 13,13,13,6 → Progress "AAAB".
   */
  private _legacyItemLabel(choice: number, letters: Record<number, string>) {
    return letters[Number(choice)] ?? 'X';
  }

  private _legacyProgressString(
    pressesIncludingCurrent: number[],
    letters: Record<number, string>,
  ) {
    return pressesIncludingCurrent.map((choice) => this._legacyItemLabel(choice, letters)).join('');
  }

  private _flashCellBorder(cell: number, durationMs = 500) {
    const next = new Set(this.borderFlashCells());
    next.add(cell);
    this.borderFlashCells.set(next);

    const existing = this.borderFlashTimers.get(cell);
    if (existing != null) window.clearTimeout(existing);

    const timerId = window.setTimeout(() => {
      const updated = new Set(this.borderFlashCells());
      updated.delete(cell);
      this.borderFlashCells.set(updated);
      this.borderFlashTimers.delete(cell);
    }, Math.max(200, durationMs));
    this.borderFlashTimers.set(cell, timerId);
  }

  private _clearBorderFlashes() {
    for (const timerId of this.borderFlashTimers.values()) {
      window.clearTimeout(timerId);
    }
    this.borderFlashTimers.clear();
    this.borderFlashCells.set(new Set());
  }

  private _nextTrialOrDone() {
    this._stopAutoDemo();
    this._clearAdvanceTimer();
    this.trialLocked = false;
    const t = this.trialIndex() + 1;
    if (t >= this.trials()) {
      this._stopAllAudio();
      this.sessionEndedEarly.set(false);
      this.phase.set('done');
      this._persistCheckpoint(false);
      this.screen.set('results');
      this._autoDownloadReportIfPossible();
      return;
    }
    this.trialIndex.set(t);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.disappearedCells.set(new Set());
    this.feedback.set(null);
    this.showCongrats.set(false);
    this.activeRewardKind.set(null);
    this.activeSurprise.set(null);
    this.activeRewardVideo.set(null);
    this._clearBorderFlashes();
    this.studyReturnToTest.set(false);
    this._beginTrial();
    this.trialStartedAt = performance.now();
    this._startTrialPhaseAfterSetup();
  }

  /**
   * Skip teacher-led study for: any trial while Automatic watch is on (ghost demos replace
   * study — otherwise kids get two sequence playbacks), or live trials whose sequence
   * already had a non-demo study this session.
   */
  private _shouldSkipTeacherStudy() {
    if (this.automaticDemo() || this.isDemoTrial()) return true;
    const key = this._sequenceKey(this.trialSequence());
    return this.liveStudyShownKeys.has(key);
  }

  private _markLiveStudyShownForCurrentSequence() {
    this.liveStudyShownKeys.add(this._sequenceKey(this.trialSequence()));
  }

  private _touchElapsedMs() {
    return Math.max(0, Math.round(performance.now() - this.testPhaseStartedAt));
  }

  private _legacyDate(d = this.sessionDate) {
    return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
  }

  /** Step index being attempted (1-based), same for location and picture tasks. */
  private _legacyPressValue(pressesBefore: number[], sequence: number[]) {
    return Math.min(this._correctProgress(pressesBefore, sequence) + 1, Math.max(1, sequence.length));
  }

  private _correctProgress(presses: number[], sequence: number[]) {
    let progress = 0;
    for (const choice of presses) {
      if (progress < sequence.length && choice === sequence[progress]) {
        progress++;
      }
    }
    return progress;
  }

  /** True if choice was already completed earlier in the correct sequence prefix. */
  private _isRepeatOfCompletedItem(choice: number, pressesBefore: number[], sequence: number[]) {
    let progress = 0;
    const completed = new Set<number>();
    for (const c of pressesBefore) {
      if (progress < sequence.length && Number(c) === Number(sequence[progress])) {
        completed.add(Number(c));
        progress++;
      }
    }
    return completed.has(Number(choice));
  }

  private _legacyPicFileName(id: number) {
    const stem = id >= 100 ? String(id) : this.pad3(id);
    return `${stem}.jpg`;
  }

  private _legacyTimeStamp(d = new Date()) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  /** Map each target id (picture or spatial cell) → A, B, C… by sequence order. */
  private _targetLetters(sequence: number[]) {
    const map: Record<number, string> = {};
    for (let i = 0; i < sequence.length; i++) {
      map[Number(sequence[i])] = String.fromCharCode(65 + i); // A, B, C…
    }
    return map;
  }

  /** Target picture filenames for this trial's sequence (legacy ListPics). */
  private _legacyListPicsForTrial(taskType: 'location' | 'picture', sequence: number[]) {
    if (taskType === 'location') {
      return 'random/identical';
    }
    return sequence.map((id) => this._legacyPicFileName(id)).join(',');
  }

  /** Target grid cells for this trial's sequence (legacy ListLocations). */
  private _legacyListLocationsForTrial(taskType: 'location' | 'picture', sequence: number[]) {
    if (taskType !== 'location') {
      return 'random';
    }
    return sequence.join(',');
  }

  private _legacySequenceBy(taskType: 'location' | 'picture') {
    return taskType === 'location' ? 'locations' : 'pictures';
  }

  private _legacyBool(value: boolean) {
    return value ? 'True' : 'False';
  }

  private _legacyTrialAccuracy(trialCorrect: boolean, isLastPress: boolean) {
    if (!trialCorrect) return 'False';
    return isLastPress ? 'True' : 'bl';
  }

  private _buildLegacyReportRows(): string[][] {
    const subject = this.subjectId().trim();
    const date = this._legacyDate();
    const rows: string[][] = [LEGACY_REPORT_HEADER.slice()];

    for (const trial of this.results()) {
      const seq = trial.sequence;
      const letters = this._targetLetters(seq);
      // Include automatic demo step presses; never drop live taps (multi-taps always recorded).
      const recordable = trial.touches.filter((t) => !t.ignored);
      const pressesSoFar: number[] = [];
      const meta = trial.report;

      for (let i = 0; i < recordable.length; i++) {
        const touch = recordable[i];
        const pressesBefore = [...pressesSoFar];
        pressesSoFar.push(touch.choice);
        const correctBefore = this._correctProgress(pressesBefore, seq);
        const expectedId = this._legacyExpectedAtProgress(seq, correctBefore);
        const isLast = i === recordable.length - 1;
        // Repeats of already-correct items are never errors in the report.
        const isRepeatTouch =
          touch.repeat || this._isRepeatOfCompletedItem(touch.choice, pressesBefore, seq);
        const touchCorrect = isRepeatTouch || touch.choice === expectedId;

        rows.push([
          subject,
          date,
          String(this._legacyPressValue(pressesBefore, seq)),
          String(meta.trialInList),
          String(meta.listNum),
          this._legacySequenceBy(trial.taskType),
          this._legacyItemLabel(touch.choice, letters),
          this._legacyItemLabel(expectedId, letters),
          this._legacyProgressString(pressesSoFar, letters),
          this._legacyBool(touchCorrect),
          this._legacyTrialAccuracy(trial.correct, isLast),
          (touch.ms / 1000).toFixed(3),
          ((trial.trialSessionStartMs + touch.ms) / 1000).toFixed(3),
          String(meta.listNum),
          meta.listPics,
          meta.listLocations,
          String(meta.trialsNum),
          String(meta.totalTrialsNum),
          String(meta.stepsNum),
          String(meta.studySeconds),
          String(meta.itiSeconds),
          this._legacyBool(meta.distractorsN > 0),
          this._legacyBool(meta.feedbackBorder),
          this._legacyBool(meta.playSound),
          this._legacyBool(meta.freeRecall),
          'True',
          this._legacyBool(meta.progressCorrectOnly),
        ]);
      }
    }

    return rows;
  }

  downloadReport() {
    if (!this.results().length) return;
    const rows = this._buildLegacyReportRows();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
    const subject = this.subjectId().trim() || 'subject';
    const date = this._legacyDate();
    const time = this._legacyTimeStamp();
    XLSX.writeFile(workbook, `SST-SCP${subject}_${date}_${time}.xlsx`);
    this._persistCheckpoint(true);
    this._refreshPendingRecovery();
  }

  /** Save in-progress taps into results (used by Early Finish, Edit setup, and quit flush). */
  private _captureInProgressTrialIfNeeded() {
    if (this.phase() === 'done') return;
    const trialNum = this.trialIndex() + 1;
    if (this.results().some((r) => r.trial === trialNum)) return;
    const hasCollected = this.trialTouches().length > 0 || this.pressed().length > 0;
    if (!hasCollected) return;
    const ms = Math.max(0, Math.round(performance.now() - this.trialStartedAt));
    const presses = this.pressed();
    const correct =
      this.testMode() === this.TestMode.FreeRecall
        ? this._isFreeRecallCorrect(presses)
        : this._isSequenceComplete(presses);
    this._recordTrialResult(presses, correct, ms, this.isDemoTrial());
  }

  private _autoDownloadReportIfPossible() {
    if (!this.results().length || this.reportAutoDownloaded()) return;
    // Defer so the results screen paints first; may be blocked without a user gesture in some browsers.
    window.setTimeout(() => {
      if (!this.results().length || this.reportAutoDownloaded()) return;
      try {
        this.downloadReport();
        this.reportAutoDownloaded.set(true);
      } catch {
        /* backup still in localStorage */
      }
    }, 250);
  }

  private _flushSessionForQuit() {
    try {
      if (this.screen() === 'run') {
        this._captureInProgressTrialIfNeeded();
      }
      if (this.results().length > 0) {
        this._persistCheckpoint(false);
      }
    } catch {
      /* ignore */
    }
  }

  private _installUnloadFlush() {
    if (typeof window === 'undefined' || this.pageHideHandler) return;
    this.pageHideHandler = () => this._flushSessionForQuit();
    window.addEventListener('pagehide', this.pageHideHandler);
    window.addEventListener('beforeunload', this.pageHideHandler);
  }

  private _persistCheckpoint(downloaded: boolean) {
    if (typeof localStorage === 'undefined') return;
    if (!this.results().length) {
      if (downloaded) this._clearCheckpoint();
      return;
    }
    const payload: SessionCheckpoint = {
      version: 1,
      savedAt: Date.now(),
      downloaded,
      subjectId: this.subjectId().trim() || 'subject',
      taskType: this.taskType(),
      testMode: this.testMode(),
      trialsPlanned: Math.max(1, this.trials()),
      sessionEndedEarly: this.sessionEndedEarly(),
      sessionDateIso: (this.sessionDate ?? new Date()).toISOString(),
      results: this.results(),
    };
    try {
      localStorage.setItem(SESSION_CHECKPOINT_KEY, JSON.stringify(payload));
      this.lastCheckpointAt.set(payload.savedAt);
      if (downloaded) this.pendingRecovery.set(null);
    } catch {
      /* quota / private mode */
    }
  }

  private _loadCheckpoint(): SessionCheckpoint | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(SESSION_CHECKPOINT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SessionCheckpoint;
      if (!parsed?.results?.length) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private _clearCheckpoint() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(SESSION_CHECKPOINT_KEY);
    } catch {
      /* ignore */
    }
    this.lastCheckpointAt.set(null);
  }

  private _refreshPendingRecovery() {
    const cp = this._loadCheckpoint();
    if (cp && !cp.downloaded && cp.results.length > 0) {
      this.pendingRecovery.set(cp);
      this.lastCheckpointAt.set(cp.savedAt);
    } else {
      this.pendingRecovery.set(null);
    }
  }

  private _stopTimer() {
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Neutral ding on each automatic watch step (independent of feedback toggles). */
  private _playAutomaticStepSound() {
    this._play('neutral');
  }

  private _play(name: 'correct' | 'wrong' | 'success' | 'neutral') {
    if (name === 'success') {
      this._playCheerMusic();
      return;
    }
    const map: Record<'correct' | 'wrong' | 'neutral', string> = {
      correct: 'assets/sfx/ding2.mp3',
      wrong: 'assets/sfx/whoosh1.wav',
      neutral: 'assets/sfx/ding2.mp3',
    };
    this._stopAllAudio();
    const audio = new Audio(map[name]);
    audio.volume = name === 'neutral' ? 0.55 : 0.9;
    audio.currentTime = 0;
    this.activeAudio = [audio];
    void audio.play().catch(() => {});
  }

  /** Congratulatory cheer for finishing a trial successfully. */
  private _playCheerMusic() {
    this._stopAllAudio();
    for (const layer of CHEER_LAYERS) {
      window.setTimeout(() => {
        const audio = new Audio(layer.src);
        audio.volume = layer.volume;
        audio.currentTime = 0;
        this.activeAudio = [...this.activeAudio, audio];
        void audio.play().catch(() => {});
      }, layer.delayMs);
    }
    const capMs = Math.max(1200, Math.min(5000, this.rewardSeconds() * 1000));
    window.setTimeout(() => this._stopAllAudio(), capMs);
  }

  private _stopAllAudio() {
    for (const a of this.activeAudio) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {}
    }
    this.activeAudio = [];
  }

  // UI helpers — shared 4×4 grid (location + picture run screen)
  onGridCellClick(cell: number) {
    if (this.taskType() === this.TaskType.Location) {
      this.onPick(cell, cell);
      return;
    }
    const picId = this.picTestCellToPic()[cell];
    if (picId != null) this.onPick(picId, cell);
  }

  isCellBorderFlashing(cell: number) {
    return this.borderFlashCells().has(cell);
  }

  isAutoHighlightCell(cell: number) {
    return this.automaticPlayback() && this.autoHighlightCell() === cell;
  }

  isGridCellActive(cell: number) {
    if (this.phase() !== 'study') return false;
    if (this.taskType() === this.TaskType.Location) {
      return this.trialSequence()[this.stepIndex()] === cell;
    }
    return (this.picStudyCellByStep()[this.stepIndex()] ?? -1) === cell;
  }

  isGridCellDisabled(cell: number) {
    if (this.phase() !== 'test') return true;
    if (this.automaticPlayback() || this.isDemoTrial() || this.trialLocked) return true;
    if (this.disappearedCells().has(cell)) return true;
    if (this.taskType() === this.TaskType.Location) {
      return !this.trialTestCells().includes(cell);
    }
    return this.picTestCellToPic()[cell] == null;
  }

  isGridCellDim(cell: number) {
    if (this.phase() !== 'test') return false;
    if (this.disappearedCells().has(cell)) return true;
    if (this.taskType() === this.TaskType.Location) {
      return !this.trialTestCells().includes(cell);
    }
    return this.picTestCellToPic()[cell] == null;
  }

  gridStepBadge(cell: number): number | null {
    if (this.phase() !== 'test') return null;
    if (this.disappearedCells().has(cell)) return null;
    if (this.taskType() === this.TaskType.Location) {
      return this.pressedBadges()[cell] ?? null;
    }
    const picId = this.picTestCellToPic()[cell];
    if (picId == null) return null;
    return this.pressedBadgesPic()[picId] ?? null;
  }

  showImageInGridCell(cell: number) {
    if (this.phase() === 'studyReady') return false;
    if (this.phase() === 'test' && this.disappearedCells().has(cell)) return false;
    if (this.taskType() === this.TaskType.Location) {
      return (
        (this.phase() === 'study' && this.isGridCellActive(cell)) ||
        (this.phase() === 'test' && this.trialTestCells().includes(cell))
      );
    }
    if (this.phase() === 'study') return this.isGridCellActive(cell);
    return this.picTestCellToPic()[cell] != null;
  }

  picIdInGridCell(cell: number) {
    if (this.taskType() === this.TaskType.Location) {
      return this.locTrialPicId();
    }
    if (this.phase() === 'study') {
      return this.trialSequence()[this.stepIndex()] ?? 1;
    }
    return this.picTestCellToPic()[cell] ?? 1;
  }

  isChoiceSelected(choice: number) {
    return this.pressed().includes(choice);
  }

  private _buildLocTrialPic() {
    this.locTrialPicId.set(this._randPic());
  }

  private _buildPicStudyLayout() {
    const steps = this.trialSequence().length;
    this.picStudyCellByStep.set(this._pickRandomGridCells(steps, false));
  }

  private _buildLocationTestCells() {
    const seq = this.trialSequence();
    const n = Math.max(0, Math.min(12, this.distractorsN()));
    const targets: number[] = [];
    const seen = new Set<number>();
    for (const cell of seq) {
      if (!seen.has(cell)) {
        seen.add(cell);
        targets.push(cell);
      }
    }
    const out = [...targets];
    while (out.length < targets.length + n) {
      const r = 1 + Math.floor(Math.random() * 16);
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  private _buildPicTestLayout() {
    const pics = this._testPictureIds();
    const cells = this._pickRandomGridCells(pics.length, true);
    const map: Record<number, number> = {};
    pics.forEach((pid, i) => {
      map[cells[i]] = pid;
    });
    this.picTestCellToPic.set(map);
  }

  private _testPictureIds() {
    const seq = this.trialSequence();
    const n = Math.max(0, Math.min(12, this.distractorsN()));
    const targets: number[] = [];
    const seen = new Set<number>();
    for (const id of seq) {
      if (!seen.has(id)) {
        seen.add(id);
        targets.push(id);
      }
    }
    const pool = this.picIds();
    const out = [...targets];
    while (out.length < targets.length + n && out.length < pool.length) {
      const r = pool[Math.floor(Math.random() * pool.length)]!;
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  /** Random cells 1–16; distinct=true requires unique cells (for test choices). */
  private _pickRandomGridCells(count: number, distinct: boolean) {
    const n = Math.max(0, Math.min(16, count));
    if (n === 0) return [];
    if (distinct) {
      const pool = Array.from({ length: 16 }, (_, i) => i + 1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, n);
    }
    return Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 16));
  }

  /**
   * Warm picture + sound caches before the session (helps museum / slow Wi‑Fi).
   * Shared for Spatial and Object — preloads every picture id used in programmed sequences.
   */
  private async _preloadSessionAssets() {
    const ids = new Set<number>();
    const trials = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    const rows =
      this.taskType() === this.TaskType.Location
        ? this.locationSequences()
        : this.pictureSequences();
    for (let t = 0; t < Math.min(trials, rows.length); t++) {
      for (const id of (rows[t] ?? []).slice(0, steps)) {
        ids.add(Number(id));
      }
    }
    // Object task: also warm a small distractor band so test layouts are snappy.
    if (this.taskType() === this.TaskType.Picture) {
      for (const id of this.picIds().slice(0, 24)) ids.add(id);
      for (const id of this.customPicIds()) ids.add(id);
    } else {
      // Spatial uses a random filler pic per trial — warm common ids.
      for (let i = 1; i <= 12; i++) ids.add(i);
    }

    const imageLoads = [...ids].map(
      (id) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = this.picSrc(id);
        }),
    );

    const sounds = [
      'assets/sfx/ding2.mp3',
      'assets/sfx/whoosh1.wav',
      ...CHEER_LAYERS.map((l) => l.src),
    ];
    const soundLoads = sounds.map(
      (src) =>
        new Promise<void>((resolve) => {
          const audio = new Audio();
          audio.preload = 'auto';
          audio.oncanplaythrough = () => resolve();
          audio.onerror = () => resolve();
          audio.src = src;
          // Kick fetch without playing.
          void audio.load();
          window.setTimeout(() => resolve(), 4000);
        }),
    );

    // Reward videos — start buffering in the background.
    for (const clip of REWARD_VIDEOS) {
      try {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.src = clip.src;
        void video.load();
      } catch {
        /* ignore */
      }
    }

    await Promise.allSettled([...imageLoads, ...soundLoads]);
  }

  pad3(n: number) {
    const x = Math.max(0, Math.floor(n));
    return x.toString().padStart(3, '0');
  }

  /** Highest usable picture id (built-in or uploaded). */
  maxPicId() {
    const custom = this.customPicIds();
    if (!custom.length) return MAX_PIC_ID;
    return Math.max(MAX_PIC_ID, ...custom);
  }

  isCustomPic(id: number) {
    return Number(id) >= CUSTOM_PIC_START;
  }

  /** Resolve built-in asset path or blob URL for an uploaded picture. */
  picSrc(id: number) {
    const n = Math.max(1, Math.floor(Number(id) || 1));
    if (this.isCustomPic(n)) {
      return this.customPicUrlById.get(n) || `assets/pics/${this.pad3(1)}.jpg`;
    }
    return `assets/pics/${this.pad3(n)}.jpg`;
  }

  private async _loadCustomPics() {
    try {
      const rows = await listCustomPicRecords();
      for (const url of this.customPicUrlById.values()) URL.revokeObjectURL(url);
      this.customPicUrlById.clear();
      const ids: number[] = [];
      for (const row of rows) {
        ids.push(row.id);
        this.customPicUrlById.set(row.id, URL.createObjectURL(row.blob));
      }
      this.customPicIds.set(ids);
    } catch {
      this.customPicIds.set([]);
    }
  }

  async onCustomPicsSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    input.value = '';
    if (!files.length) return;
    this.picUploadBusy.set(true);
    try {
      let nextId =
        this.customPicIds().reduce((m, id) => Math.max(m, id), CUSTOM_PIC_START - 1) + 1;
      const added: number[] = [];
      for (const file of files) {
        try {
          const blob = await normalizeUploadImage(file);
          const id = nextId++;
          await putCustomPicRecord({ id, mime: 'image/jpeg', blob, addedAt: Date.now() });
          this.customPicUrlById.set(id, URL.createObjectURL(blob));
          added.push(id);
        } catch {
          /* skip bad file */
        }
      }
      if (added.length) {
        this.customPicIds.set([...this.customPicIds(), ...added].sort((a, b) => a - b));
      }
    } finally {
      this.picUploadBusy.set(false);
    }
  }

  async removeCustomPic(id: number, ev?: Event) {
    ev?.stopPropagation();
    ev?.preventDefault();
    if (!this.isCustomPic(id)) return;
    try {
      await deleteCustomPicRecord(id);
    } catch {
      /* still drop from UI */
    }
    const url = this.customPicUrlById.get(id);
    if (url) URL.revokeObjectURL(url);
    this.customPicUrlById.delete(id);
    this.customPicIds.set(this.customPicIds().filter((x) => x !== id));
    // Remap any sequence steps that pointed at the removed picture.
    const fallback = 1;
    const remapped = this.pictureSequences().map((row) =>
      row.map((pid) => (Number(pid) === Number(id) ? fallback : pid)),
    );
    this.pictureSequences.set(remapped);
  }

  private _randPic(avoid: Set<number> = new Set()) {
    const pool = this.picIds();
    for (let i = 0; i < 40; i++) {
      const r = pool[Math.floor(Math.random() * pool.length)]!;
      if (!avoid.has(r)) return r;
    }
    for (const r of pool) if (!avoid.has(r)) return r;
    return 1;
  }

  setPictureStep(trialIdx: number, stepIdx: number, value: string) {
    const pic = Math.max(1, Math.min(this.maxPicId(), Number(value) || 1));
    const t = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    let next = this._normalizeSequences(this.pictureSequences(), t, steps, 1, this.maxPicId(), DEFAULT_PICTURE_ROWS).map(
      (row) => [...row],
    );
    if (!next[trialIdx]) return;
    next[trialIdx][stepIdx] = pic;
    if (this.sameSequenceForAllTrials()) next = this._syncAllTrialsToMaster(next);
    this.pictureSequences.set(next);
    this._onTrialSequencesChanged();
  }

  openPicPicker(trialIdx: number, stepIdx: number) {
    this.picPickerTrial.set(this.sameSequenceForAllTrials() ? 0 : trialIdx);
    this.picPickerStep.set(stepIdx);
    this.picPickerOpen.set(true);
  }

  closePicPicker() {
    this.picPickerOpen.set(false);
  }

  pickPic(pid: number) {
    const ti = this.picPickerTrial();
    const si = this.picPickerStep();
    this.setPictureStep(ti, si, String(pid));
    this.picPickerOpen.set(false);
  }

  isPicUsedElsewhereInTrial(trialIdx: number, stepIdx: number, pid: number) {
    const row = this.pictureSequences()[trialIdx] ?? [];
    for (let i = 0; i < row.length; i++) {
      if (i !== stepIdx && row[i] === pid) return true;
    }
    return false;
  }

  openLocPicker(trialIdx: number, stepIdx: number) {
    this.locPickerTrial.set(this.sameSequenceForAllTrials() ? 0 : trialIdx);
    this.locPickerStep.set(stepIdx);
    this.locPickerOpen.set(true);
  }

  closeLocPicker() {
    this.locPickerOpen.set(false);
  }

  pickLoc(cell: number) {
    const ti = this.locPickerTrial();
    const si = this.locPickerStep();
    this.setLocationStep(ti, si, String(cell));
    this.locPickerOpen.set(false);
  }

  isLocUsedElsewhereInTrial(trialIdx: number, stepIdx: number, cell: number) {
    const row = this.locationSequences()[trialIdx] ?? [];
    for (let i = 0; i < row.length; i++) {
      if (i !== stepIdx && row[i] === cell) return true;
    }
    return false;
  }

  setLocationStep(trialIdx: number, stepIdx: number, value: string) {
    const cell = Math.max(1, Math.min(16, Number(value) || 1));
    const t = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    let next = this._normalizeSequences(this.locationSequences(), t, steps, 1, 16, DEFAULT_LOCATION_ROWS).map(
      (row) => [...row],
    );
    if (!next[trialIdx]) return;
    next[trialIdx][stepIdx] = cell;
    if (this.sameSequenceForAllTrials()) next = this._syncAllTrialsToMaster(next);
    this.locationSequences.set(next);
    this._onTrialSequencesChanged();
  }

  private _firstUnusedInRange(used: number[], minVal: number, maxVal: number) {
    const usedSet = new Set(used);
    for (let v = minVal; v <= maxVal; v++) {
      if (!usedSet.has(v)) return v;
    }
    return minVal;
  }

  private _normalizeSequences(
    seqs: number[][],
    trials: number,
    steps: number,
    minVal: number,
    maxVal: number,
    seedRows: number[][] = [],
  ) {
    const safeVal = (x: number | undefined, fallback: number) => {
      const n = Number(x);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(minVal, Math.min(maxVal, Math.floor(n)));
    };
    const seed = seedRows.length ? seedRows : seqs;
    const out: number[][] = [];
    for (let i = 0; i < trials; i++) {
      const prev = seqs[i] ?? seed[i % seed.length] ?? [];
      const row: number[] = [];
      for (let s = 0; s < steps; s++) {
        if (prev[s] !== undefined && Number.isFinite(Number(prev[s]))) {
          row.push(safeVal(prev[s], minVal));
        } else {
          row.push(this._firstUnusedInRange(row, minVal, maxVal));
        }
      }
      out.push(row);
    }
    return out;
  }
}
