import { handleAppError } from "./app-errors.js";

// App statuses
export const NOT_LOADED = "NOT_LOADED";
export const LOADING_SOURCE_CODE = "LOADING_SOURCE_CODE";
export const NOT_BOOTSTRAPPED = "NOT_BOOTSTRAPPED";
export const BOOTSTRAPPING = "BOOTSTRAPPING";
export const NOT_MOUNTED = "NOT_MOUNTED";
export const MOUNTING = "MOUNTING";
export const MOUNTED = "MOUNTED";
export const UPDATING = "UPDATING";
export const UNMOUNTING = "UNMOUNTING";
export const UNLOADING = "UNLOADING";
export const LOAD_ERROR = "LOAD_ERROR";
export const SKIP_BECAUSE_BROKEN = "SKIP_BECAUSE_BROKEN";

/**
 * 判断微应用状态是否活跃（是否被安装，已被安装即为活跃
 * @param {*} app 
 * @returns 
 */
export function isActive(app) {
  return app.status === MOUNTED;
}

/**
 * 判断当前微应用是否活跃
 * @param {*} app 
 * @returns 
 */
export function shouldBeActive(app) {
  try {
    return app.activeWhen(window.location);
  } catch (err) {
    handleAppError(err, app, SKIP_BECAUSE_BROKEN);
    return false;
  }
}

/**
 * 获取微应用名称
 * @param {*} app 
 * @returns 
 */
export function toName(app) {
  return app.name;
}

/**
 * 是否为包装
 * @param {*} appOrParcel 
 * @returns 
 */
export function isParcel(appOrParcel) {
  return Boolean(appOrParcel.unmountThisParcel);
}

/**
 * 应用类型
 * @param {*} appOrParcel 
 * @returns 
 */
export function objectType(appOrParcel) {
  return isParcel(appOrParcel) ? "parcel" : "application";
}
