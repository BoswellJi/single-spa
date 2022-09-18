import { routingEventsListeningTo } from "./navigation/navigation-events.js";

let hasInitialized = false;

export function ensureJQuerySupport(jQuery = window.jQuery) {
  if (!jQuery) {
    if (window.$ && window.$.fn && window.$.fn.jquery) {
      jQuery = window.$;
    }
  }

  if (jQuery && !hasInitialized) {
    const originalJQueryOn = jQuery.fn.on;
    const originalJQueryOff = jQuery.fn.off;

    jQuery.fn.on = function (eventString, fn) {
      return captureRoutingEvents.call(
        this,
        originalJQueryOn,
        window.addEventListener,
        eventString,
        fn,
        arguments
      );
    };

    jQuery.fn.off = function (eventString, fn) {
      return captureRoutingEvents.call(
        this,
        originalJQueryOff,
        window.removeEventListener,
        eventString,
        fn,
        arguments
      );
    };

    hasInitialized = true;
  }
}

/**
 * 捕获路由事件
 * @param {*} originalJQueryFunction 原始的jquery注册监听器的函数
 * @param {*} nativeFunctionToCall 原始的web注册监听器的函数
 * @param {*} eventString 事件名
 * @param {*} fn 监听器
 * @param {*} originalArgs 参数
 * @returns 
 */
function captureRoutingEvents(
  originalJQueryFunction,
  nativeFunctionToCall,
  eventString,
  fn,
  originalArgs
) {
  // 这里是因为jquery事件可能是object类型的参数{click:fn,dbclick:fn}
  if (typeof eventString !== "string") {
    return originalJQueryFunction.apply(this, originalArgs);
  }
  // 分割事件到数组中，'hashchange popstate'
  const eventNames = eventString.split(/\s+/);
  // 遍历事件
  eventNames.forEach((eventName) => {
    // 事件必须时hashchange popstate
    if (routingEventsListeningTo.indexOf(eventName) >= 0) {
      // 才会使用原生注册监听器函数
      nativeFunctionToCall(eventName, fn);
      // 注册后从原始的事件参数中去掉
      eventString = eventString.replace(eventName, "");
    }
  });

  // 事件字符串空了，说明只有popstate,hashchange这两种事件
  if (eventString.trim() === "") {
    return this;
  } else {
    return originalJQueryFunction.apply(this, originalArgs);
  }
}
