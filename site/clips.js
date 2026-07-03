/* GoodStrata homepage clips — tiny, dependency-free playback shim.
   Each .clip autoplays MUTED and loops as ambient motion only while ≥50% in
   view (IntersectionObserver), and pauses when it leaves. A big centred PLAY
   button sits over the idle clip; pressing it plays the clip WITH SOUND from
   the start (loop off) as a one-shot. When that playthrough ends, a full-frame
   "Watch again" overlay restarts it with sound; if it's merely paused, the play
   button returns so it can be restarted with sound.

   On MOBILE (≤880px) a clip that is playing WITH SOUND docks to the TOP of the
   viewport (fixed, full-width, squared corners) so it stays visible while the
   reader scrolls; a spacer of the EXACT frame height holds its place so there's
   zero layout shift, and a small ✕ dismisses it (pause + undock). Desktop and
   prefers-reduced-motion never dock. All of this is generic over every .clip,
   so clips added later inherit it.

   Honours prefers-reduced-motion and the Save-Data header: in either case the
   video is never loaded, the poster stands in, and no controls are shown. No
   CLS: the frame reserves its 16:9 box via CSS aspect-ratio. Safe if no clip is
   present. */
(function () {
  "use strict";

  var clips = document.querySelectorAll(".clip");
  if (!clips.length) return;

  // Opt-out signals: never fetch the video, keep the poster, no playback UI.
  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData = !!(conn && conn.saveData);

  // Dock only while the hero stacks to one column (matches the CSS breakpoint).
  var MOBILE = window.matchMedia("(max-width: 880px)");

  Array.prototype.forEach.call(clips, function (clip) {
    setupClip(clip);
  });

  function setupClip(clip) {
    var video = clip.querySelector("video");
    if (!video) return;
    var frame = clip.querySelector(".clip-frame") || video.parentNode;
    var againBtn = clip.querySelector(".clip-again");

    if (reduce || saveData) {
      clip.classList.add("clip-static");
      return; // no video load, no controls (they ship `hidden`)
    }

    // --- Play-with-sound button (generic: built for every clip) ---
    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "clip-play";
    playBtn.setAttribute("aria-label", "Play with sound");
    playBtn.innerHTML = '<span class="clip-play-disc" aria-hidden="true"></span>';
    frame.appendChild(playBtn);

    // --- ✕ dismiss control, only shown while docked (generic per clip) ---
    var dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "clip-dismiss";
    dismissBtn.setAttribute("aria-label", "Close video");
    dismissBtn.innerHTML = '<span aria-hidden="true">✕</span>';
    frame.appendChild(dismissBtn);

    var spacer = null;

    function canDock() {
      return MOBILE.matches && !reduce;
    }
    function dock() {
      if (!canDock()) return;
      if (clip.classList.contains("clip-docked")) return;
      // Reserve the EXACT current frame height so the flow doesn't move.
      var h = frame.getBoundingClientRect().height;
      spacer = document.createElement("div");
      spacer.className = "clip-spacer";
      spacer.style.height = h + "px";
      frame.parentNode.insertBefore(spacer, frame);
      clip.classList.add("clip-docked");
    }
    function undock() {
      if (!clip.classList.contains("clip-docked")) return;
      clip.classList.remove("clip-docked");
      if (spacer && spacer.parentNode) spacer.parentNode.removeChild(spacer);
      spacer = null;
    }

    // Ambient muted playback. preload="none" means the first play() also loads.
    var ambientPlay = function () {
      var p = video.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    };

    // Opt into sound: unmute, drop the loop, restart from 0, play as a one-shot;
    // dock to the top on mobile so it stays on screen.
    var playWithSound = function () {
      playBtn.hidden = true;
      if (againBtn) againBtn.hidden = true;
      video.loop = false;
      video.muted = false;
      try {
        video.currentTime = 0;
      } catch (e) {}
      var p = video.play();
      dock();
      if (p && typeof p.catch === "function")
        p.catch(function () {
          undock();
        });
    };

    playBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      playWithSound();
    });
    if (againBtn) {
      againBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        playWithSound();
      });
    }
    dismissBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      video.pause(); // fires 'pause' → returns the play button
      undock();
    });

    // Reflect real playback state onto the overlays.
    video.addEventListener("playing", function () {
      if (againBtn) againBtn.hidden = true;
      // Play button shows over the muted ambient loop, hides once sound is on.
      playBtn.hidden = !video.muted;
      if (video.muted) undock();
    });
    video.addEventListener("pause", function () {
      // A genuine stop (dismiss, scroll-out, tab hide): bring the play button
      // back so the clip can be restarted WITH SOUND. 'ended' handles its own.
      if (!video.ended) playBtn.hidden = false;
      undock();
    });
    // A with-sound playthrough finished (loop off) → offer "Watch again".
    video.addEventListener("ended", function () {
      playBtn.hidden = true;
      if (againBtn) againBtn.hidden = false;
      undock();
    });

    // Leaving mobile width (rotate / resize to desktop) can't stay docked.
    var onMQ = function () {
      if (!MOBILE.matches) undock();
    };
    if (MOBILE.addEventListener) MOBILE.addEventListener("change", onMQ);
    else if (MOBILE.addListener) MOBILE.addListener(onMQ);

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
            // Watch-again overlay up); only auto-resume the muted ambient loop.
            if (video.ended) return;
            if (video.muted) ambientPlay();
          } else if (
            !video.paused &&
            !clip.classList.contains("clip-docked")
          ) {
            // Out of view and not docked → pause (ambient saves resources;
            // a docked with-sound clip keeps playing at the top).
            video.pause();
          }
        });
      },
      { threshold: [0, 0.5, 1] },
    );

    io.observe(clip);
  }
})();
