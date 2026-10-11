/* Upscroll — inline icon set (24px grid, stroke icons). */
(function () {
  const P = {
    bookmark: '<path d="M6 3.5h12v17l-6-4.2-6 4.2z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    less: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
    spark: '<path d="M12 2.8l1.9 5.6 5.6 1.9-5.6 1.9L12 17.8l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    check: '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>',
    flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.5 2.6-5.6 3.9-8.8.4 1.9 1.3 3 2.4 3.6.2-2.6 1.4-4.9 3.2-6.6.2 3.1 3.5 5.6 3.5 10.6 0 4.2-2.8 7.4-6.5 7.4z"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
    feed: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 9.5l3-2.5 3 2.5M9 16l3-2.5 3 2.5"/>',
    sky: '<circle cx="7" cy="7" r="1.6"/><circle cx="17" cy="9" r="1.6"/><circle cx="10" cy="17" r="1.6"/><path d="M8.4 7.6l7.2 1M16 10.3l-4.8 5.6M8.3 8.3l1.3 7.2"/>',
    vault: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9.5 13.5h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    hole: '<ellipse cx="12" cy="15" rx="8" ry="3.5"/><path d="M12 3.5v8M8.5 8l3.5 3.5L15.5 8"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-5-4-5-1.5S12 9 12 9zm0 0c1.5-3.5 5-4 5-1.5S12 9 12 9z"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  };
  window.UP.icon = function (name, cls) {
    const span = document.createElement("span");
    span.className = "ico" + (cls ? " " + cls : "");
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || "") + "</svg>";
    return span;
  };
})();
