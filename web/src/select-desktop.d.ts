export {};

declare global {
  interface Window {
    selectDesktop?: {
      platform: string;
      closeApp: () => void;
    };
  }
}
