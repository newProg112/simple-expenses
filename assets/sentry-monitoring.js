(function initialiseSentryMonitoring(window, document) {
  "use strict";

  const approvedHostnames = new Set([
    "simple-books.co.uk",
    "simple-books-office.web.app"
  ]);
  const loaderId = "simple-books-sentry-loader";
  const loaderUrl = "https://js-de.sentry-cdn.com/9ca6428f0668673bd5ba75766bdcdc9f.min.js";

  function isApprovedHostname(hostname) {
    return approvedHostnames.has(String(hostname || "").toLowerCase());
  }

  function urlWithoutQueryOrFragment(value) {
    if(typeof value !== "string" || !value) return value;

    try {
      const url = new URL(value, window.location.origin);
      if(!["http:", "https:"].includes(url.protocol)) return value;
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return value.split(/[?#]/, 1)[0];
    }
  }

  function sanitiseEvent(event) {
    if(!event || typeof event !== "object") return event;

    if(event.request && typeof event.request === "object") {
      if(event.request.url) {
        event.request.url = urlWithoutQueryOrFragment(event.request.url);
      }
      delete event.request.data;
      delete event.request.headers;
      delete event.request.cookies;
      delete event.request.query_string;
    }

    delete event.user;
    delete event.extra;

    const exceptions = event.exception && Array.isArray(event.exception.values)
      ? event.exception.values
      : [];

    for(const exception of exceptions) {
      const frames = exception && exception.stacktrace && Array.isArray(exception.stacktrace.frames)
        ? exception.stacktrace.frames
        : [];

      for(const frame of frames) {
        if(frame && frame.filename) {
          frame.filename = urlWithoutQueryOrFragment(frame.filename);
        }
      }
    }

    return event;
  }

  function sanitiseBreadcrumb(breadcrumb) {
    if(!breadcrumb || breadcrumb.category !== "navigation") return null;

    const data = breadcrumb.data && typeof breadcrumb.data === "object"
      ? breadcrumb.data
      : {};
    const navigationData = {};

    if(data.from) navigationData.from = urlWithoutQueryOrFragment(data.from);
    if(data.to) navigationData.to = urlWithoutQueryOrFragment(data.to);

    breadcrumb.data = navigationData;
    delete breadcrumb.message;
    return breadcrumb;
  }

  if(window.__SIMPLE_BOOKS_SENTRY_TEST__ === true) {
    window.__SIMPLE_BOOKS_SENTRY_TEST_API__ = Object.freeze({
      isApprovedHostname,
      sanitiseBreadcrumb,
      sanitiseEvent,
      urlWithoutQueryOrFragment
    });
  }

  if(!isApprovedHostname(window.location.hostname)) return;
  if(document.getElementById(loaderId)) return;

  // Sentry's documented Loader Script hook for custom SDK configuration.
  window.sentryOnLoad = function configureSentry() {
    window.Sentry.init({
      environment: "production",
      sendDefaultPii: false,
      beforeSend: sanitiseEvent,
      beforeBreadcrumb: sanitiseBreadcrumb
      // TODO: Add a deployment-generated release identifier in a later phase.
    });
  };

  const loader = document.createElement("script");
  loader.id = loaderId;
  loader.src = loaderUrl;
  loader.crossOrigin = "anonymous";
  document.head.appendChild(loader);
})(window, document);
