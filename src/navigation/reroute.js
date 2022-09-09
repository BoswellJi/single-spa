import CustomEvent from "custom-event";
import { isStarted } from "../start.js";
import { toLoadPromise } from "../lifecycles/load.js";
import { toBootstrapPromise } from "../lifecycles/bootstrap.js";
import { toMountPromise } from "../lifecycles/mount.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import {
  getAppStatus,
  getAppChanges,
  getMountedApps,
} from "../applications/apps.js";
import {
  callCapturedEventListeners,
  navigateToUrl,
} from "./navigation-events.js";
import { toUnloadPromise } from "../lifecycles/unload.js";
import {
  toName,
  shouldBeActive,
  NOT_MOUNTED,
  MOUNTED,
  NOT_LOADED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { assign } from "../utils/assign.js";
import { isInBrowser } from "../utils/runtime-environment.js";

let appChangeUnderway = false,
  peopleWaitingOnAppChange = [],
  currentUrl = isInBrowser && window.location.href;

export function triggerAppChange() {
  // Call reroute with no arguments, intentionally
  return reroute();
}

export function reroute(pendingPromises = [], eventArguments) {
  if (appChangeUnderway) {
    return new Promise((resolve, reject) => {
      peopleWaitingOnAppChange.push({
        resolve,
        reject,
        eventArguments,
      });
    });
  }

  const {
    appsToUnload,
    appsToUnmount,
    appsToLoad,
    appsToMount,
  } = getAppChanges();
  let appsThatChanged,
    navigationIsCanceled = false,
    oldUrl = currentUrl,
    newUrl = (currentUrl = window.location.href);

    // 开始加载微应用
  if (isStarted()) {
    appChangeUnderway = true;
    appsThatChanged = appsToUnload.concat(
      appsToLoad,
      appsToUnmount,
      appsToMount
    );
    return performAppChanges();
  } else {
    appsThatChanged = appsToLoad;
    return loadApps();
  }

  function cancelNavigation() {
    navigationIsCanceled = true;
  }

  function loadApps() {
    return Promise.resolve().then(() => {
      // 加载所有load状态的微应用
      const loadPromises = appsToLoad.map(toLoadPromise);

      return (
        // 加载完成所以待加载状态的微应用
        Promise.all(loadPromises)
          .then(callAllEventListeners)
          // there are no mounted apps, before start() is called, so we always return []
          // start()调用前，没有已安装的app,所以我们一直返回空数组
          .then(() => [])
          .catch((err) => {
            callAllEventListeners();
            throw err;
          })
      );
    });
  }

  function performAppChanges() {
    return Promise.resolve().then(() => {
      // https://github.com/single-spa/single-spa/issues/545
      window.dispatchEvent(
        new CustomEvent(
          appsThatChanged.length === 0
            ? "single-spa:before-no-app-change"
            : "single-spa:before-app-change",
          getCustomEventDetail(true)
        )
      );

      window.dispatchEvent(
        new CustomEvent(
          "single-spa:before-routing-event",
          getCustomEventDetail(true, { cancelNavigation })
        )
      );

      if (navigationIsCanceled) {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
        finishUpAndReturn();
        navigateToUrl(oldUrl);
        return;
      }

      // 退出所有unload状态的微应用
      const unloadPromises = appsToUnload.map(toUnloadPromise);
      // 卸载所有的mount状态的微应用
      const unmountUnloadPromises = appsToUnmount
        .map(toUnmountPromise)
        .map((unmountPromise) => unmountPromise.then(toUnloadPromise));

        // 合并退出和卸载的微应用
      const allUnmountPromises = unmountUnloadPromises.concat(unloadPromises);

      const unmountAllPromise = Promise.all(allUnmountPromises);

      // 所有需要卸载的微应用都卸载完成
      unmountAllPromise.then(() => {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
      });

      /**
       * We load and bootstrap apps while other apps are unmounting, but we
       * 当其他微应用正在卸载时，我们加载和启动微应用，
       * wait to mount the app until all apps are finishing unmounting
       * 我们等待所有当前微应用卸载完成后，才安装微应用
       */
      const loadThenMountPromises = appsToLoad.map((app) => {
        return toLoadPromise(app).then((app) =>
          tryToBootstrapAndMount(app, unmountAllPromise)
        );
      });

      /** 
       * These are the apps that are already bootstrapped and just need
       * 这些app已经被启动并且需要被安装
       * to be mounted. They each wait for all unmounting apps to finish up
       * 他们安装之前，相互等待所有卸载中的微应用完成
       * before they mount.
       */
      const mountPromises = appsToMount
        .filter((appToMount) => appsToLoad.indexOf(appToMount) < 0)
        .map((appToMount) => {
          return tryToBootstrapAndMount(appToMount, unmountAllPromise);
        });
      return unmountAllPromise
        .catch((err) => {
          callAllEventListeners();
          throw err;
        })
        .then(() => {
          /**
           * Now that the apps that needed to be unmounted are unmounted, their DOM navigation
           * 既然微应用需要被卸载，他们的dom导航事件应该被清理
           * events (like hashchange or popstate) should have been cleaned up. So it's safe
           * 所以保留捕获事件监听器处理dom事件
           * to let the remaining captured event listeners to handle about the DOM event.
           */
          callAllEventListeners();

          return Promise.all(loadThenMountPromises.concat(mountPromises))
            .catch((err) => {
              pendingPromises.forEach((promise) => promise.reject(err));
              throw err;
            })
            .then(finishUpAndReturn);
        });
    });
  }

  function finishUpAndReturn() {
    // 已经安装的微应用
    const returnValue = getMountedApps();
    // 执行promise回调的reslove函数
    pendingPromises.forEach((promise) => promise.resolve(returnValue));

    try {
      const appChangeEventName =
        appsThatChanged.length === 0
          ? "single-spa:no-app-change"
          : "single-spa:app-change";
      window.dispatchEvent(
        new CustomEvent(appChangeEventName, getCustomEventDetail())
      );
      window.dispatchEvent(
        new CustomEvent("single-spa:routing-event", getCustomEventDetail())
      );
    } catch (err) {
      /** 
       * We use a setTimeout because if someone else's event handler throws an error, single-spa
       * 因为如果某个其他的事件处理器抛出一个错误，我们使用一个setTimeout
       * needs to carry on. If a listener to the event throws an error, it's their own fault, not
       * single-spa需要继续执行，如果一个事件的监听器抛出一个错误，是他自己的错误，不是single-spa的
       * single-spa's.
       */
      setTimeout(() => {
        throw err;
      });
    }

    /**
     * Setting this allows for subsequent calls to reroute() to actually perform
     * 配置这个允许序列调用reroute来实际执行一个路由，
     * a reroute instead of just getting queued behind the current reroute call.
     * We want to do this after the mounting/unmounting is done but before we
     * 安装卸载完成后，我们想要做这个，但是，在那之前，我们解析reroute函数的promise之前
     * resolve the promise for the `reroute` function.
     */
    appChangeUnderway = false;

    if (peopleWaitingOnAppChange.length > 0) {
      /* While we were rerouting, someone else triggered another reroute that got queued.
       * So we need reroute again.
       */
      const nextPendingPromises = peopleWaitingOnAppChange;
      peopleWaitingOnAppChange = [];
      reroute(nextPendingPromises);
    }

    return returnValue;
  }

  /**
   * We need to call all event listeners that have been delayed because they were
   * 我们需要调用所有已经被延迟的事件监听器，因为他们正在single-spa上等待
   * waiting on single-spa. This includes haschange and popstate events for both
   * 这包括haschange和popstate事件两者
   * the current run of performAppChanges(), but also all of the queued event listeners.
   * 不仅当前的performAppChanges()运行，而且所有排队的事件监听器
   * We want to call the listeners in the same order as if they had not been delayed by
   * 即使没有被single-spa延迟，我也还是想要用相同的顺序调用监听器
   * single-spa, which means queued ones first and then the most recent one.
   * 这意味着一个接着一个
   */
  function callAllEventListeners() {
    pendingPromises.forEach((pendingPromise) => {
      callCapturedEventListeners(pendingPromise.eventArguments);
    });

    callCapturedEventListeners(eventArguments);
  }

  /**
   * 定义自定义事件的：事件对象信息
   * @param {*} isBeforeChanges 
   * @param {*} extraProperties 
   * @returns 
   */
  function getCustomEventDetail(isBeforeChanges = false, extraProperties) {
    const newAppStatuses = {};
    const appsByNewStatus = {
      // for apps that were mounted
      [MOUNTED]: [],
      // for apps that were unmounted
      [NOT_MOUNTED]: [],
      // apps that were forcibly unloaded
      [NOT_LOADED]: [],
      // apps that attempted to do something but are broken now
      [SKIP_BECAUSE_BROKEN]: [],
    };

    if (isBeforeChanges) {
      appsToLoad.concat(appsToMount).forEach((app, index) => {
        addApp(app, MOUNTED);
      });
      appsToUnload.forEach((app) => {
        addApp(app, NOT_LOADED);
      });
      appsToUnmount.forEach((app) => {
        addApp(app, NOT_MOUNTED);
      });
    } else {
      appsThatChanged.forEach((app) => {
        addApp(app);
      });
    }

    const result = {
      detail: {
        newAppStatuses,
        appsByNewStatus,
        totalAppChanges: appsThatChanged.length,
        originalEvent: eventArguments?.[0],
        oldUrl,
        newUrl,
        navigationIsCanceled,
      },
    };

    if (extraProperties) {
      assign(result.detail, extraProperties);
    }

    return result;

    function addApp(app, status) {
      const appName = toName(app);
      status = status || getAppStatus(appName);
      newAppStatuses[appName] = status;
      const statusArr = (appsByNewStatus[status] =
        appsByNewStatus[status] || []);
      statusArr.push(appName);
    }
  }
}

/**
 * Let's imagine that some kind of delay occurred during application loading.
 * 让我想想一下，在应用加载期间出现了某种延迟
 * The user without waiting for the application to load switched to another route,
 * 用户没有等待应用加载切换另一个路由
 * this means that we shouldn't bootstrap and mount that application, thus we check
 * 这意味着，我们不应该启动和安装应用程序，
 * twice if that application should be active before bootstrapping and mounting.
 * 因此，如果启动中和安装中之前应用应该活跃，我们就检查两次
 * https://github.com/single-spa/single-spa/issues/524
 */
function tryToBootstrapAndMount(app, unmountAllPromise) {
  if (shouldBeActive(app)) {
    // 启动所有需要启动的微应用
    return toBootstrapPromise(app).then((app) =>
    // 卸载完需要卸载状态的微应用之后，才能安装，待安装的微应用
      unmountAllPromise.then(() =>
        shouldBeActive(app) ? toMountPromise(app) : app
      )
    );
  } else {
    return unmountAllPromise.then(() => app);
  }
}
