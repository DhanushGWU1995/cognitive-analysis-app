export {};

declare global {
  interface Window {
    selectDesktop?: {
      platform: string;
      closeApp: () => void;
      openSubjectDisplay?: () => void;
      publishSubjectFrame?: (frame: unknown) => void;
      sendSubjectHello?: () => void;
      sendSubjectTap?: (cell: number) => void;
      onSubjectFrame?: (cb: (frame: unknown) => void) => void;
      onSubjectTap?: (cb: (cell: number) => void) => void;
      onSubjectHello?: (cb: () => void) => void;
      onSubjectClosed?: (cb: () => void) => void;
    };
  }
}
