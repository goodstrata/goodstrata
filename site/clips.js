/* GoodStrata homepage clips — tiny, dependency-free playback shim.
   Plays a muted looped clip only while ≥50% in view, pauses when it leaves.
   Honours prefers-reduced-motion and the Save-Data header: in either case the
   video is never loaded and the poster frame stands in. No CLS: the frame
   reserves its 16:9 box via CSS aspect-ratio, so the poster fills it from the
   first paint. Safe if the clip is absent (guards on #c1-clip). */
(function () {
  "use strict";

  var clip = document.getElementById("c1-clip");
  if (!clip) return;
  var video = clip.querySelector("video");
  if (!video) return;

  // Opt-out signals: never fetch the video, keep the poster.
  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData = !!(conn && conn.saveData);

  if (reduce || saveData) {
    clip.classList.add("clip-static");
    return;
  }

  var tryPlay = function () {
    // preload="none" means the first play() also kicks off the load.
    var p = video.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
  };

  // No IntersectionObserver (very old browser): load + play once, best effort.
  if (!("IntersectionObserver" in window)) {
    tryPlay();
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          tryPlay();
        } else if (!video.paused) {
          video.pause();
        }
      });
    },
    { threshold: [0, 0.5, 1] },
  );

  io.observe(clip);
})();
