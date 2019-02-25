import bugsnagClient from './bugsnag';
import origins from '../origins';
const browser = require('webextension-polyfill');

const ORIGINS_KEY = 'TogglButton-origins';

// settings: key, default value
const DEFAULT_SETTINGS = {
  startAutomatically: false,
  stopAutomatically: false,
  showRightClickButton: true,
  showPostPopup: true,
  nannyCheckEnabled: true,
  nannyInterval: 3600000,
  nannyFromTo: '09:00-17:00',
  idleDetectionEnabled: false,
  pomodoroModeEnabled: false,
  pomodoroSoundFile: 'sounds/time_is_up_1.mp3',
  pomodoroSoundEnabled: true,
  pomodoroSoundVolume: 1,
  pomodoroStopTimeTrackingWhenTimerEnds: true,
  pomodoroInterval: 25,
  stopAtDayEnd: false,
  dayEndTime: '17:00',
  defaultProject: 0,
  projects: '',
  rememberProjectPer: 'false',
  enableAutoTagging: false
};

// core settings: key, default value
const CORE_SETTINGS = {
  'dont-show-permissions': false,
  'show-permissions-info': 0,
  'settings-active-tab': 0,
  sendErrorReports: true,
  sendUsageStatistics: true
};

export default class Db {
  constructor (togglButton) {
    this.togglButton = togglButton;
    this.loadAll();

    browser.runtime.onMessage.addListener(this.newMessage);
  }

  async newMessage (request, sender, sendResponse) {
    try {
      if (request.type === 'toggle-popup') {
        this.set('showPostPopup', request.state);
      } else if (request.type === 'toggle-nanny') {
        this.updateSetting(
          'nannyCheckEnabled',
          request.state,
          this.togglButton.setNannyTimer
        );
      } else if (request.type === 'toggle-nanny-from-to') {
        const nannyCheckEnabled = await this.get('nannyCheckEnabled');
        this.updateSetting(
          'nannyFromTo',
          request.state,
          this.togglButton.setNannyTimer,
          nannyCheckEnabled
        );
      } else if (request.type === 'toggle-nanny-interval') {
        const nannyCheckEnabled = await this.get('nannyCheckEnabled');
        this.updateSetting(
          'nannyInterval',
          Math.max(request.state, 1000),
          this.togglButton.setNannyTimer,
          nannyCheckEnabled
        );
      } else if (request.type === 'toggle-idle') {
        this.updateSetting(
          'idleDetectionEnabled',
          request.state,
          this.togglButton.startCheckingUserState
        );
      } else if (request.type === 'toggle-pomodoro') {
        this.set('pomodoroModeEnabled', request.state);
      } else if (request.type === 'toggle-pomodoro-sound') {
        this.set('pomodoroSoundEnabled', request.state);
      } else if (request.type === 'toggle-pomodoro-interval') {
        this.updateSetting('pomodoroInterval', request.state);
      } else if (request.type === 'toggle-pomodoro-stop-time') {
        this.set('pomodoroStopTimeTrackingWhenTimerEnds', request.state);
      } else if (request.type === 'update-pomodoro-sound-volume') {
        this.set('pomodoroSoundVolume', request.state);
      } else if (request.type === 'toggle-right-click-button') {
        this.updateSetting('showRightClickButton', request.state);
      } else if (request.type === 'toggle-start-automatically') {
        this.updateSetting('startAutomatically', request.state);
      } else if (request.type === 'toggle-stop-automatically') {
        this.updateSetting('stopAutomatically', request.state);
      } else if (request.type === 'toggle-stop-at-day-end') {
        this.updateSetting('stopAtDayEnd', request.state);
        this.togglButton.startCheckingDayEnd(request.state);
      } else if (request.type === 'toggle-day-end-time') {
        this.updateSetting('dayEndTime', request.state);
      } else if (request.type === 'change-default-project') {
        this.updateSetting(
          browser.extension.getBackgroundPage().this.togglButton.$user.id +
            '-defaultProject',
          request.state
        );
      } else if (request.type === 'change-remember-project-per') {
        this.updateSetting('rememberProjectPer', request.state);
        this.resetDefaultProjects();
      } else if (
        request.type === 'update-dont-show-permissions' ||
        request.type === 'update-settings-active-tab'
      ) {
        this.updateSetting(request.type.substr(7), request.state);
      } else if (
        request.type === 'update-send-usage-statistics'
      ) {
        this.updateSetting('sendUsageStatistics', request.state);
      } else if (
        request.type === 'update-send-error-reports'
      ) {
        this.updateSetting('sendErrorReports', request.state);
      } else if (
        request.type === 'update-enable-auto-tagging'
      ) {
        this.updateSetting('enableAutoTagging', request.state);
      }
    } catch (e) {
      bugsnagClient.notify(e);
    }

    return true;
  };

  getOriginFileName (domain) {
    let origin = this.getOrigin(domain);

    if (!origin) {
      origin = domain;
    }

    if (!origins[origin]) {
      // Handle cases where subdomain is used (like web.any.do (or sub1.sub2.any.do), we remove web from the beginning)
      origin = origin.split('.');
      while (origin.length > 0 && !origins[origin.join('.')]) {
        origin.shift();
      }
      origin = origin.join('.');
      if (!origins[origin]) {
        return null;
      }
    }

    const item = origins[origin];

    if (item.file) {
      return item.file;
    }

    return item.name.toLowerCase().replace(' ', '-') + '.js';
  }

  async getOrigin (origin) {
    const origins = await this.get(ORIGINS_KEY);
    return origins[origin] || null;
  }

  async setOrigin (newOrigin, baseOrigin) {
    const origins = await this.get(ORIGINS_KEY);
    origins[newOrigin] = baseOrigin;
    this.set(ORIGINS_KEY, {
      ...origins,
      [newOrigin]: baseOrigin
    });
  }

  async removeOrigin (origin) {
    const origins = await this.get(ORIGINS_KEY);
    delete origins[origin];
    this.set(ORIGINS_KEY, origins);
  }

  async getAllOrigins () {
    const origins = await this.get(ORIGINS_KEY);
    return origins || null;
  }

  /**
   * Sets the default project for a given scope
   * @param {number} pid The project id
   * @param {string=} scope The scope to remember that project.
   * If null, then set global default
   */
  async setDefaultProject (pid, scope) {
    const userId = this.togglButton.$user.id;
    const defaultProjects = await this.get(userId + '-defaultProjects');
    if (!scope) {
      return this.set(userId + '-defaultProject', pid);
    }
    defaultProjects[scope] = pid;
    this.set(userId + '-defaultProjects', JSON.stringify(defaultProjects));
  }

  /**
   * Gets the default project for a given scope
   * @param {string=} scope If null, then get global default
   * @returns {number} The default project for the given scope
   */
  async getDefaultProject (scope) {
    if (!this.togglButton.$user) {
      return 0;
    }
    const userId = this.togglButton.$user.id;
    const defaultProjects = await this.get(userId + '-defaultProjects');
    let defaultProject = await this.get(userId + '-defaultProject');
    defaultProject = parseInt(defaultProject || '0', 10);

    if (!scope || !defaultProjects) {
      return defaultProject;
    }
    return defaultProjects[scope] || defaultProject;
  }

  resetDefaultProjects () {
    if (!this.togglButton.$user) {
      return;
    }
    this.set(this.togglButton.$user.id + '-defaultProjects', null);
  }

  get (setting) {
    return browser.storage.sync.get([setting])
      .then((result) => {
        let value = result[setting];
        if (value) {
          // This is kept around to ensure older version's settings still function.
          if (value === 'false' || value === 'true') {
            value = JSON.parse(value);
          }
        }
        return value;
      });
  }

  set (setting, value) {
    return browser.storage.sync.set({ [setting]: value });
  }

  async load (setting, defaultValue) {
    let value = await this.get(setting);
    if (value) {
      if (typeof defaultValue === 'boolean') {
        value = JSON.parse(value);
      }
    } else {
      value = defaultValue;
    }
    this.set(setting, value);
    return value;
  }

  loadAll () {
    for (const k in DEFAULT_SETTINGS) {
      if (DEFAULT_SETTINGS.hasOwnProperty(k)) {
        this.load(k, DEFAULT_SETTINGS[k]);
      }
    }

    for (const k in CORE_SETTINGS) {
      if (CORE_SETTINGS.hasOwnProperty(k)) {
        this.load(k, CORE_SETTINGS[k]);
      }
    }
  }

  updateSetting (key, state, callback, condition) {
    const c = condition !== null ? condition : state;
    this.set(key, state);

    if (c && callback !== null) {
      callback();
    }
  }
}
