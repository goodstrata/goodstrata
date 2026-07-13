/* GoodStrata homepage clips — tiny, dependency-free playback shim.
   Each .clip stays paused on its poster until the visitor presses the big
   centred PLAY button. That explicit action plays the clip WITH SOUND from the
   start as a one-shot. When that playthrough ends, a full-frame
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

    // Below-the-fold clips ship their poster in `data-poster` (no `poster`
    // attribute) so ~280KB of imagery stops competing with the hero at page
    // load; assign it only when the clip is actually needed. The .clip-frame's
    // dark band background stands in until then, so a late poster fades in
    // rather than popping into a blank box.
    function ensurePoster() {
      if (!video.poster && video.dataset && video.dataset.poster) {
        video.poster = video.dataset.poster;
      }
    }

    if (reduce || saveData) {
      ensurePoster(); // the poster IS the experience here — load it now
      clip.classList.add("clip-static");
      return; // no video load, no controls (they ship `hidden`)
    }

    // Reveal deferred posters shortly before their clips enter view. Do not
    // warm the video itself here: a failed speculative source selection can
    // leave browsers in NETWORK_NO_SOURCE without a media error, which makes a
    // later user-initiated play request hang or reject. The explicit click is
    // deliberately the first time the media is loaded.
    if ("IntersectionObserver" in window) {
      var posterObserver = new IntersectionObserver(
        function (entries, observer) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            ensurePoster();
            observer.disconnect();
          });
        },
        { rootMargin: "600px 0px" },
      );
      posterObserver.observe(clip);
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

    // --- recoverable message line (hidden until something goes wrong) ---
    // A brief, in-voice line shown over the frame when a play/load fails, so a
    // tap is never silently eaten and there's always a way forward.
    var msg = document.createElement("p");
    msg.className = "clip-msg";
    msg.hidden = true;
    msg.setAttribute("role", "status");
    frame.appendChild(msg);
    function showMsg(text) {
      msg.textContent = text;
      msg.hidden = false;
    }
    function hideMsg() {
      msg.hidden = true;
    }

    // Pending state: keep the play disc visible but disabled, with a spinner,
    // from the click until playback actually starts (preload="none" means the
    // first play() also fetches the file, so there can be a real gap).
    function setPending(on) {
      if (on) playBtn.classList.add("is-pending");
      else playBtn.classList.remove("is-pending");
      playBtn.disabled = on;
    }

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

    // Opt into sound: unmute, restart from 0, play as a one-shot;
    // dock to the top on mobile so it stays on screen.
    var playWithSound = function () {
      hideMsg();
      if (againBtn) againBtn.hidden = true;
      setPending(true); // keep the disc visible in a pending state until playback
      video.loop = false;
      video.muted = false;
      try {
        // A previous network/media error requires an explicit reload before a
        // visitor can retry. This remains inside the click-driven path.
        if (video.error) video.load();
        video.currentTime = 0;
      } catch (e) {}
      var p = video.play();
      dock();
      // The play() promise resolves once playback is under way — including the
      // case where the element was already playing, which the 'playing' event
      // does not cover (see onPlaying).
      if (p && typeof p.then === "function") p.then(onPlaying, function () {});
      if (p && typeof p.catch === "function")
        p.catch(function () {
          // Recover instead of leaving a dead poster frame: undock, restore the
          // initial paused defaults, bring the play affordance back, and
          // say what happened so the reader can retry.
          setPending(false);
          undock();
          video.loop = false;
          video.muted = true;
          playBtn.hidden = false;
          showMsg("That didn’t play — tap play to try again.");
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
    //
    // NOTE: 'playing' only fires when playback STARTS after being paused,
    // waiting or stalled, so this is also driven off the play() promise and
    // 'timeupdate' below for older/Safari event behaviour.
    function onPlaying() {
      setPending(false); // pixels are moving — clear the pending/loading state
      hideMsg();
      if (againBtn) againBtn.hidden = true;
      playBtn.hidden = true;
    }
    video.addEventListener("playing", onPlaying);
    // Last line of defence: the frame has advanced, so playback is real,
    // whatever the events did or didn't say (no play() promise on old browsers;
    // Safari can also swallow 'playing' on an already-playing element).
    video.addEventListener("timeupdate", function () {
      if (!video.paused && playBtn.classList.contains("is-pending")) onPlaying();
    });
    video.addEventListener("pause", function () {
      setPending(false);
      // A genuine stop (dismiss, scroll-out, tab hide): bring the play button
      // back so the clip can be restarted WITH SOUND. 'ended' handles its own.
      if (!video.ended) playBtn.hidden = false;
      undock();
    });
    // A with-sound playthrough finished (loop off) → offer "Watch again".
    video.addEventListener("ended", function () {
      setPending(false);
      playBtn.hidden = true;
      if (againBtn) againBtn.hidden = false;
      undock();
    });
    // A speculative preload can emit a transient media error even when the
    // poster or a fallback source is usable. Keep background loading silent;
    // only surface an error when it interrupts an explicit play attempt.
    video.addEventListener("error", function () {
      var explicitAttempt = playBtn.classList.contains("is-pending");
      setPending(false);
      undock();
      video.loop = false;
      video.muted = true;
      playBtn.hidden = false;
      if (againBtn) againBtn.hidden = true;
      if (explicitAttempt) {
        showMsg("Couldn’t load the video — tap play to retry, or use the summary and link below.");
      }
    });
    video.addEventListener("loadeddata", hideMsg);
    video.addEventListener("canplay", hideMsg);

    // Leaving mobile width (rotate / resize to desktop) can't stay docked.
    var onMQ = function () {
      if (!MOBILE.matches) undock();
    };
    if (MOBILE.addEventListener) MOBILE.addEventListener("change", onMQ);
    else if (MOBILE.addListener) MOBILE.addListener(onMQ);

    // No IntersectionObserver (very old browser): leave the poster and explicit
    // play control in place. Playback must never start as a fallback behaviour.
    if (!("IntersectionObserver" in window)) {
      ensurePoster();
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
          if (
            !inView &&
            !video.paused &&
            !clip.classList.contains("clip-docked")
          ) {
            // Out of view and not docked → pause; a docked with-sound clip
            // keeps playing at the top until the visitor dismisses it.
            video.pause();
          }
        });
      },
      { threshold: [0, 0.5, 1] },
    );

    io.observe(clip);
  }
})();
