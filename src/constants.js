/**
 * Multi URL Opener - Core Constants
 * by nzrfzr
 */

export const SESSION_STATUS = Object.freeze({
  READY: 'ready',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors'
});

export const ROW_STATUS = Object.freeze({
  READY: 'ready',
  QUEUED: 'queued',
  WAITING_FOR_SELECTION: 'waiting_for_selection',
  CREATING_TAB: 'creating_tab',
  LOADING: 'loading',
  SUCCESS: 'success',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
  SKIPPED: 'skipped',
  STOPPED: 'stopped'
});

export const OPEN_MODE = Object.freeze({
  OPEN_ALL: 'open_all',
  AT_INTERVAL: 'at_interval',
  AFTER_LOAD: 'after_load'
});

export const DEFAULTS = Object.freeze({
  MODE: OPEN_MODE.AT_INTERVAL,
  INTERVAL_SECONDS: 2,
  CONCURRENCY_LIMIT: 3,
  TIMEOUT_SECONDS: 30,
  OPEN_IN_BACKGROUND: true,
  DEFER_UNTIL_SELECTED: false
});

export const LIMITS = Object.freeze({
  MIN_CONCURRENCY: 1,
  MAX_CONCURRENCY: 10,
  MIN_INTERVAL: 0.5,
  MAX_INTERVAL: 60,
  MIN_TIMEOUT: 5,
  MAX_TIMEOUT: 300
});

export const MESSAGE_TYPES = Object.freeze({
  PING: 'PING',
  GET_STATE: 'GET_STATE',
  UPDATE_PREFERENCES: 'UPDATE_PREFERENCES',
  ADD_URL_TEXT: 'ADD_URL_TEXT',
  SET_ROW_SELECTION: 'SET_ROW_SELECTION',
  SELECT_ALL: 'SELECT_ALL',
  SELECT_NONE: 'SELECT_NONE',
  DELETE_SELECTED: 'DELETE_SELECTED',
  DELETE_ROW: 'DELETE_ROW',
  CLEAR_LIST: 'CLEAR_LIST',
  START_QUEUE: 'START_QUEUE',
  PAUSE_QUEUE: 'PAUSE_QUEUE',
  RESUME_QUEUE: 'RESUME_QUEUE',
  STOP_QUEUE: 'STOP_QUEUE',
  STATE_UPDATED: 'STATE_UPDATED'
});

export const STORAGE_KEYS = Object.freeze({
  STATE: 'multi_url_opener_state_v1'
});
