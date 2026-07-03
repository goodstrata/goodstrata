/* GoodStrata homepage clips — tiny, dependency-free playback shim.
   The C1 clip autoplays MUTED and loops as ambient motion only while ≥50% in
   view (IntersectionObserver), and pauses when it leaves. A tap/click unmutes,
   restarts from 0, and plays it with sound as a one-shot (loop off); when that
   sound playthrough ends, a big "Watch again" overlay restarts it with sound.
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

  var soundHint = clip.querySelector(".clip-sound");
  var againBtn = clip.querySelector(".clip-again");

  // Opt-out signals: never fetch the video, keep the poster, hide affordances.
  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData = !!(conn && conn.saveData);

  if (reduce || saveData) {
    clip.classList.add("clip-static");
    return; // buttons stay hidden (they ship with the `hidden` attribute)
  }

  // JS is on and the clip will play — reveal the "tap for sound" pill.
  if (soundHint) soundHint.hidden = false;

  // Ambient muted playback. preload="none" means the first play() also loads.
  var ambientPlay = function () {
    var p = video.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
  };

  // Opt into sound: unmute, drop the loop, restart from 0, play as a one-shot.
  var playWithSound = function () {
    clip.classList.add("clip-sound-on"); // hides the "tap for sound" pill
    if (againBtn) againBtn.hidden = true;
    video.loop = false;
    video.muted = false;
    try {
      video.currentTime = 0;
    } catch (e) {}
    var p = video.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
  };

  // Tapping the muted ambient loop turns sound on. Once sound is on, taps on
  // the video do nothing (the Watch-again overlay owns replays).
  video.addEventListener("click", function () {
    if (video.muted) playWithSound();
  });
  if (soundHint) {
    soundHint.addEventListener("click", function (e) {
      e.stopPropagation();
      playWithSound();
    });
  }
  if (againBtn) {
    againBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      playWithSound();
    });
  }

  // A with-sound playthrough finished (loop is off) → offer "Watch again".
  video.addEventListener("ended", function () {
    if (againBtn) againBtn.hidden = false;
  });

  // No IntersectionObserver (very old browser): load + play once, best effort.
  if (!("IntersectionObserver" in window)) {
    ambientPlay();
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        var inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (inView) {
          // Don't restart a finished with-sound playthrough (leave the
          // Watch-again overlay up); otherwise resume whatever state we're in.
          if (video.ended) return;
          ambientPlay();
        } else if (!video.paused) {
          video.pause();
        }
      });
    },
    { threshold: [0, 0.5, 1] },
  );

  io.observe(clip);
})();
