// Browser mock for Electron APIs
// This file provides mock implementations for window.electron and window.appConfig
// when running in browser mode for development

interface MockElectronAPI {
  platform: string;
  reactReady: () => void;
  getConfig: () => Record<string, unknown>;
  hideWindow: () => void;
  directoryChooser: (replace?: boolean) => Promise<Electron.OpenDialogReturnValue>;
  createChatWindow: (
    query?: string,
    dir?: string,
    version?: string,
    resumeSessionId?: string,
    recipe?: any,
    viewType?: string
  ) => void;
  logInfo: (txt: string) => void;
  showNotification: (data: any) => void;
  showMessageBox: (options: any) => Promise<any>;
  openInChrome: (url: string) => void;
  fetchMetadata: (url: string) => Promise<string>;
  reloadApp: () => void;
  checkForOllama: () => Promise<boolean>;
  selectFileOrDirectory: (defaultPath?: string) => Promise<string | null>;
  startPowerSaveBlocker: () => Promise<number>;
  stopPowerSaveBlocker: () => Promise<void>;
  getBinaryPath: (binaryName: string) => Promise<string>;
  readFile: (directory: string) => Promise<any>;
  writeFile: (directory: string, content: string) => Promise<boolean>;
  ensureDirectory: (dirPath: string) => Promise<boolean>;
  listFiles: (dirPath: string, extension?: string) => Promise<string[]>;
  getAllowedExtensions: () => Promise<string[]>;
  getPathForFile: (file: File) => string;
  setMenuBarIcon: (show: boolean) => Promise<boolean>;
  getMenuBarIconState: () => Promise<boolean>;
  setDockIcon: (show: boolean) => Promise<boolean>;
  getDockIconState: () => Promise<boolean>;
  getSettings: () => Promise<unknown | null>;
  getSecretKey: () => Promise<string>;
  setSchedulingEngine: (engine: string) => Promise<boolean>;
  setWakelock: (enable: boolean) => Promise<boolean>;
  getWakelockState: () => Promise<boolean>;
  openNotificationsSettings: () => Promise<boolean>;
  onMouseBackButtonClicked: (callback: () => void) => void;
  offMouseBackButtonClicked: (callback: () => void) => void;
  on: (channel: string, callback: (event: any, ...args: unknown[]) => void) => void;
  off: (channel: string, callback: (event: any, ...args: unknown[]) => void) => void;
  emit: (channel: string, ...args: unknown[]) => void;
  saveDataUrlToTemp: (dataUrl: string, uniqueId: string) => Promise<any>;
  deleteTempFile: (filePath: string) => void;
  openExternal: (url: string) => Promise<void>;
  getTempImage: (filePath: string) => Promise<string | null>;
  getVersion: () => string;
  checkForUpdates: () => Promise<{ updateInfo: unknown; error: string | null }>;
  downloadUpdate: () => Promise<{ success: boolean; error: string | null }>;
  installUpdate: () => void;
  restartApp: () => void;
  onUpdaterEvent: (callback: (event: any) => void) => void;
  getUpdateState: () => Promise<{ updateAvailable: boolean; latestVersion?: string } | null>;
  closeWindow: () => void;
  hasAcceptedRecipeBefore: (recipeConfig: any) => Promise<boolean>;
  recordRecipeHash: (recipeConfig: any) => Promise<void>;
  openDirectoryInExplorer: (directoryPath: string) => Promise<void>;
}

interface MockAppConfigAPI {
  get: (key: string) => unknown;
  getAll: () => Record<string, unknown>;
}

// Mock implementations
const mockElectronAPI: MockElectronAPI = {
  platform: 'browser',
  reactReady: () => console.log('React ready (browser mode)'),
  getConfig: () => ({
    GOOSE_API_HOST: 'http://localhost',
    GOOSE_PORT: '3000',
    GOOSE_VERSION: 'dev-browser',
    VITE_START_EMBEDDED_SERVER: 'no'
  }),
  hideWindow: () => console.log('hideWindow called (browser mode)'),
  directoryChooser: () => Promise.resolve({ canceled: true, filePaths: [] }),
  createChatWindow: () => console.log('createChatWindow called (browser mode)'),
  logInfo: (txt: string) => console.log('[BROWSER LOG]', txt),
  showNotification: (data: any) => console.log('Notification:', data),
  showMessageBox: (options: any) => {
    console.log('MessageBox options:', options);
    return Promise.resolve({ response: 0 });
  },
  openInChrome: (url: string) => window.open(url, '_blank'),
  fetchMetadata: (url: string) => {
    console.log('Fetching metadata for:', url);
    return Promise.resolve('Mock metadata');
  },
  reloadApp: () => window.location.reload(),
  checkForOllama: () => Promise.resolve(false),
  selectFileOrDirectory: () => Promise.resolve(null),
  startPowerSaveBlocker: () => Promise.resolve(1),
  stopPowerSaveBlocker: () => Promise.resolve(),
  getBinaryPath: () => Promise.resolve('/mock/path'),
  readFile: () => Promise.resolve({ file: '', filePath: '', error: 'Not implemented in browser mode', found: false }),
  writeFile: () => Promise.resolve(false),
  ensureDirectory: () => Promise.resolve(false),
  listFiles: () => Promise.resolve([]),
  getAllowedExtensions: () => Promise.resolve([]),
  getPathForFile: (file: File) => file.name,
  setMenuBarIcon: () => Promise.resolve(false),
  getMenuBarIconState: () => Promise.resolve(false),
  setDockIcon: () => Promise.resolve(false),
  getDockIconState: () => Promise.resolve(false),
  getSettings: () => Promise.resolve(null),
  getSecretKey: () => Promise.resolve('test'),
  setSchedulingEngine: () => Promise.resolve(false),
  setWakelock: () => Promise.resolve(false),
  getWakelockState: () => Promise.resolve(false),
  openNotificationsSettings: () => Promise.resolve(false),
  onMouseBackButtonClicked: () => {},
  offMouseBackButtonClicked: () => {},
  on: () => {},
  off: () => {},
  emit: () => {},
  saveDataUrlToTemp: () => Promise.resolve({ id: '', error: 'Not implemented in browser mode' }),
  deleteTempFile: () => {},
  openExternal: (url: string) => Promise.resolve(window.open(url, '_blank') ? undefined : undefined),
  getTempImage: () => Promise.resolve(null),
  getVersion: () => 'dev-browser',
  checkForUpdates: () => Promise.resolve({ updateInfo: null, error: 'Not implemented in browser mode' }),
  downloadUpdate: () => Promise.resolve({ success: false, error: 'Not implemented in browser mode' }),
  installUpdate: () => {},
  restartApp: () => window.location.reload(),
  onUpdaterEvent: () => {},
  getUpdateState: () => Promise.resolve(null),
  closeWindow: () => {},
  hasAcceptedRecipeBefore: () => Promise.resolve(false),
  recordRecipeHash: () => Promise.resolve(),
  openDirectoryInExplorer: () => Promise.resolve(),
};

const mockAppConfigAPI: MockAppConfigAPI = {
  get: (key: string) => {
    const config: Record<string, unknown> = {
      GOOSE_API_HOST: 'http://localhost',
      GOOSE_PORT: '3000',
      GOOSE_VERSION: 'dev-browser',
      VITE_START_EMBEDDED_SERVER: 'no',
      GOOSE_MODEL: 'gpt-4o',
      GOOSE_PROVIDER: 'openai'
    };
    return config[key];
  },
  getAll: () => ({
    GOOSE_API_HOST: 'http://localhost',
    GOOSE_PORT: '3000',
    GOOSE_VERSION: 'dev-browser',
    VITE_START_EMBEDDED_SERVER: 'no',
    GOOSE_MODEL: 'gpt-4o',
    GOOSE_PROVIDER: 'openai'
  }),
};

// Only expose mocks if we're not in Electron
if (typeof window !== 'undefined' && !window.electron) {
  (window as any).electron = mockElectronAPI;
  (window as any).appConfig = mockAppConfigAPI;
}
