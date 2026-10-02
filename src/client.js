// Client half of dsh-domain-watch: a presence pill in the harness shell.
//
// WHY A PILL AND NOT JUST THE PAGE. The board answers "what is happening"; the pill answers
// "is it on, and is it working" — which is a different question, asked far more often, by someone
// who is not going to open a tab to ask it. It is always visible on purpose: a thing that is always
// there makes its own ABSENCE meaningful, and an indicator that comes and goes cannot tell you it
// has broken.
//
// THE THREE RULES THIS FILE OBEYS, all of them from the layman's seat:
//
//   1. Colour changes the MOMENT it is invoked, before the answer arrives. The worst thing an
//      assistant can do is go quiet — "did it hear me, is it thinking, did it die?" — so the
//      acknowledgement cannot wait for the result.
//      ENFORCED WITH A FLOOR (ACK_MS), not merely hoped for. A .ke registry answers in 24-74 ms while
//      this pill polls at POLL_MS, so before the floor existed the acknowledgement rendered in about
//      one invocation in thirteen — and nothing in the UI invoked a check at all, so in use it never
//      rendered. Rule 1 was a claim the code did not keep. The floor is what makes it true.
//   2. It can say "I don't know." A failed poll shows `?`, never a tick. A status light that lies
//      is the exact failure this plugin exists to catch; committing it here would be self-refuting.
//   3. Every colour carries a WORD, and every alarming state carries a VERB in its tooltip. A
//      developer sees red and checks the logs. Everyone else sees red and needs to be told what
//      to do, or the light is just anxiety.
//
// Nothing here decides anything: the level, the words and the action sentence all arrive from
// `/domain-watch/state`, derived host-side, so the pill and the board can never disagree.
//
// The prologue below is the LOADER CONTRACT and is copied verbatim from a working pill. Omitting
// it — or the `id` — is the recorded boot-screen crash, so do not "tidy" it.
window.__ModuleLoader__.load({
  id: "dsh-domain-watch",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const inject = ["slots", "timer"];

    const POLL_MS = 1000;
    /** How long the green "done" acknowledgement stays up after a check returns. */
    const DONE_MS = 2500;
    /** A result older than this is history, not news — it must not produce a celebration. */
    const RECENT_MS = 6000;
    /**
     * The MINIMUM time the blue "checking" acknowledgement stays up, however fast the answer comes.
     *
     * This exists because of a measured defect: a .ke whois answers in 24-74 ms and this pill polls
     * at POLL_MS, so the blue tint was rendered in roughly one invocation in thirteen — and since
     * nothing in the UI triggered a check, in practice it never rendered at all. An acknowledgement
     * nobody can see is not an acknowledgement.
     *
     * It is a BOUND, not a delay. When ACK_MS elapses the truth takes over whatever it is, so a slow
     * or failing check can never hide behind it — which is why this is allowed to exist at all in a
     * plugin whose whole thesis is that a status light must not lie.
     */
    const ACK_MS = 1200;

    /**
     * Background/foreground PAIRS, not hues.
     *
     * The pill sits on the harness's overlay background, which is light in the light theme and dark
     * in the dark one — so a bare accent colour would pass in one theme and fail in the other. These
     * chips carry their own fill, which makes the contrast a property of the chip and not of the
     * theme underneath it.
     */
    // GLASS, NOT PAINT.
    //
    // The first cut used solid fills — #dc2626, #15803d — and they were too loud: an alarm chip
    // that heavy reads as an error dialog bolted onto the shell, not as a status light. A status
    // light should tint the glass, not replace it.
    //
    // Each state is now a translucent TINT plus a rim and a soft glow, with the text left in the
    // pill's own colour. That last part is not cosmetic: the pill sits on
    // `--dsw-alias-bg-overlay`, which is pale in the light theme and dark in the dark one, so a
    // fixed text colour would pass in one theme and fail in the other. `inherit` makes legibility a
    // property of the theme rather than of this file — and the contrast is then MEASURED, not
    // assumed, because a translucent fill is exactly where a declared-colour check lies.
    const CHIP = {
      calm: { bg: "transparent", fg: "inherit", border: "transparent", glow: "none" },
      working: { bg: "rgba(59,130,246,0.14)", dimBg: "rgba(59,130,246,0.22)", fg: "inherit", border: "rgba(96,165,250,0.55)", glow: "0 0 10px rgba(59,130,246,0.28)" },
      done: { bg: "rgba(34,197,94,0.14)", dimBg: "rgba(34,197,94,0.22)", fg: "inherit", border: "rgba(74,222,128,0.55)", glow: "0 0 10px rgba(34,197,94,0.26)" },
      attention: { bg: "rgba(245,158,11,0.15)", dimBg: "rgba(245,158,11,0.23)", fg: "inherit", border: "rgba(251,191,36,0.60)", glow: "0 0 10px rgba(245,158,11,0.28)" },
      alarm: { bg: "rgba(239,68,68,0.16)", dimBg: "rgba(239,68,68,0.24)", fg: "inherit", border: "rgba(248,113,113,0.65)", glow: "0 0 12px rgba(239,68,68,0.34)" },
      unknown: { bg: "rgba(148,163,184,0.12)", fg: "inherit", border: "rgba(148,163,184,0.50)", glow: "none" },
      connecting: { bg: "transparent", fg: "inherit", border: "transparent", glow: "none" },
    };

    function prefersReducedMotion() {
      try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (e) {
        return false;
      }
    }

    /**
     * THE PILL'S WHOLE DECISION, as a pure function of what is known.
     *
     * Hoisted out of the component and exported for exactly one reason: inside a React function body
     * this was untestable, and untestable is how rule 1 — "colour changes the MOMENT it is invoked"
     * — became a claim the code did not keep for a whole day. It takes values and returns a state.
     * No hooks, no DOM, and no clock of its own.
     *
     * THE ORDER OF THE BRANCHES IS THE DESIGN, not an accident of editing:
     *   1. `null` reachable  -> connecting, because rendering `?` before the first poll answers
     *      would be a small lie at the exact moment the user decides whether to trust the light.
     *   2. unreachable       -> `?`. Never a tick.
     *   3. ACKNOWLEDGING     -> working. Outranks the summary, because a registry that answers in
     *      24 ms must not be able to swallow the acknowledgement of the user's own click.
     *   4. the summary       -> including the green "done" flash.
     */
    function pillState(input) {
      const acknowledging = input.now < input.invokedUntil;
      const showDone = input.now < input.doneUntil;
      const summary = input.summary;
      const reachable = input.reachable;
      const state = {
        level: "unknown",
        label: "domains ?",
        action: "Can't check right now — no answer from the plugin.",
        glyph: null,
        acknowledging: acknowledging,
        showDone: showDone,
      };

      if (reachable === null) {
        state.level = "connecting";
        state.label = "…";
      } else if (reachable === false) {
        state.level = "unknown";
        state.label = "?";
      } else if (acknowledging) {
        state.level = "working";
        state.label = summary && summary.level === "working" ? summary.label : "checking…";
        state.action = "Asking the registry now — this takes a second or two.";
      } else if (summary) {
        state.level = showDone ? "done" : summary.level;
        state.label = showDone
          ? (summary.lastResult ? summary.lastResult.domain : "done")
          : summary.label;
        state.glyph = showDone ? "✓" : summary.glyph;
        state.action = showDone ? "Just checked." : (summary.action || "");
      }
      return state;
    }

    function DomainWatchPill(props) {
      const interval = props.interval;
      const [summary, setSummary] = React.useState(null);
      // THREE states, not two. `null` = not yet answered. Rendering `?` before the first poll
      // returns would flash a wrong state on every page load — a small lie at exactly the moment
      // the user is deciding whether to trust the light.
      const [reachable, setReachable] = React.useState(null);
      const [doneUntil, setDoneUntil] = React.useState(0);
      const [invokedUntil, setInvokedUntil] = React.useState(0);
      const [now, setNow] = React.useState(Date.now());
      const [dim, setDim] = React.useState(false);
      const [pos, setPos] = React.useState({ x: 0, y: 0 });
      const dragRef = React.useRef(null);
      const lastResultAt = React.useRef(null);
      const tickRef = React.useRef(null);
      const reduced = React.useRef(prefersReducedMotion());

      // Poll the PLUGIN, never the registry: this reads remembered facts, so a browser tab cannot
      // hammer whois. The registry is asked only when the agent or the board asks.
      React.useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const res = await fetch("/domain-watch/state", { cache: "no-store" });
            if (!res.ok) throw new Error("http " + res.status);
            const payload = await res.json();
            if (!alive) return;
            if (payload && payload.ok === true && payload.summary) {
              setSummary(payload.summary);
              setReachable(true);
              const at = payload.summary.lastResult ? payload.summary.lastResult.at : null;
              if (at && at !== lastResultAt.current) {
                lastResultAt.current = at;
                // RECENCY, not just difference. `lastResultAt` starts null, so "changed" is true on
                // the very first poll of every page load — which flashed a green "done" for a check
                // that happened hours ago. Caught by measuring the chip colour and finding green
                // where the state said red. An acknowledgement that fires when nothing just
                // happened is a lie, and it is the exact lie this plugin exists to catch.
                if (Date.now() - Date.parse(at) < RECENT_MS) setDoneUntil(Date.now() + DONE_MS);
              }
            } else {
              setReachable(false);
            }
          } catch (e) {
            if (alive) setReachable(false);
          }
        };
        // The click handler polls again the moment its re-check resolves, so the result lands
        // promptly instead of waiting up to POLL_MS behind an acknowledgement that has already
        // ended. Without this the pill could show blue, then blink back to calm, then go green.
        tickRef.current = tick;
        tick();
        const dispose = interval ? interval(tick, POLL_MS) : null;
        return () => {
          alive = false;
          tickRef.current = null;
          if (typeof dispose === "function") dispose();
        };
      }, [interval]);

      // The whole decision lives in `pillState`, a pure function defined at module level. It used to
      // be inlined here, AFTER the breath effect had already decided from the raw summary whether to
      // pulse — so the breath and the render each had their own opinion about which state the pill
      // was in. One derivation, and one that a test can call.
      const view = pillState({ reachable: reachable, summary: summary, now: now, invokedUntil: invokedUntil, doneUntil: doneUntil });
      const level = view.level;
      const label = view.label;
      const action = view.action;
      const glyph = view.glyph;

      // The breath. Driven here rather than by injected CSS so there is no stylesheet to collide
      // with, and so `prefers-reduced-motion` is a plain early return rather than a media query
      // someone can forget. It follows the EFFECTIVE level, so an acknowledged click breathes too.
      React.useEffect(() => {
        if (reduced.current) return undefined;
        const isWorking = level === "working";
        const isTrouble = level === "attention" || level === "alarm";
        const isDone = level === "done";
        if (!isWorking && !isTrouble && !isDone) return undefined;
        const period = isWorking ? 700 : isDone ? 500 : 1250;
        const id = setInterval(() => {
          setDim((d) => !d);
          setNow(Date.now());
        }, period);
        return () => clearInterval(id);
      }, [level]);

      // Expire whichever acknowledgement is running. Without a timer on `invokedUntil` as well,
      // `now` goes stale and the pill freezes in a state that has already ended.
      React.useEffect(() => {
        const pending = [doneUntil, invokedUntil].filter((t) => t > Date.now());
        if (pending.length === 0) return undefined;
        const at = Math.min.apply(null, pending);
        const id = setTimeout(() => setNow(Date.now()), Math.max(20, at - Date.now() + 20));
        return () => clearTimeout(id);
      }, [doneUntil, invokedUntil, now]);

      // WHAT A CLICK DOES: re-check, and acknowledge. It no longer opens the board.
      //
      // It used to call `window.open("/domain-watch/ui")`, so the one gesture the host's own text
      // advertised — "Click to check them now" — was the one gesture that checked nothing. The board
      // moved to the apps pill, where a page belongs; a status light's click should do the cheap,
      // frequent thing and answer in the shell.
      function invokeRecheck() {
        const t = Date.now();
        // Colour changes on the CLICK, before a byte goes out. That is the whole of rule 1.
        setInvokedUntil(t + ACK_MS);
        setNow(t);
        fetch("/domain-watch/recheck", { method: "POST", cache: "no-store" })
          .then(() => { if (tickRef.current) return tickRef.current(); })
          .catch(() => { /* the next poll reports `?` if the plugin is unreachable */ });
      }

      function onPointerDown(e) {
        if (e.button !== 0) return;
        dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      }
      function onPointerMove(e) {
        const d = dragRef.current;
        if (!d || e.pointerId !== d.id) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setPos((p) => ({ x: (p.x || 0) + dx, y: (p.y || 0) + dy }));
        dragRef.current = { id: d.id, sx: e.clientX, sy: e.clientY, moved: d.moved };
      }
      function onPointerUp(e) {
        const d = dragRef.current;
        dragRef.current = null;
        // A drag is not a click. Without this, moving the pill would also fire a check.
        if (d && d.moved) return;
        invokeRecheck();
      }

      const chip = CHIP[level] || CHIP.unknown;
      const pulsing = !reduced.current && (level === "working" || level === "attention" || level === "alarm" || level === "done");
      const opacity = pulsing && dim ? 0.55 : 1;

      return React.createElement(
        "div",
        {
          "data-app": "domain-watch",
          "data-level": level,
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          title: (action || "Domain watch") + "  ·  click to re-check, drag to move",
          style: {
            position: "fixed",
            // TOP-LEFT OF ITS OWN ROW, BESIDE THE APPS PILL.
            //
            // `shell.overlay` is an ADDITIVE LIST SLOT WITH NO LAYOUT MANAGER — its entries are
            // positioned by nothing, so every pill hard-codes its own corner. The two that exist
            // already have: app-launcher took `left: 16`, cost-bubble took `right: 16`.
            //
            // This pill was first written at `right: 16` too and rendered ON TOP of cost-bubble —
            // caught by rendering it and looking, not by reading the code. `order` does NOT help:
            // it orders children inside the slot, and fixed-position children ignore flow.
            //
            // 104 = the Apps pill (left 16, ~76px wide) + a 12px gap. Measured on the live shell
            // 2026-10-01. If that pill's label ever grows, this number moves with it.
            left: 104,
            bottom: 16,
            zIndex: 2147483000,
            transform: "translate(" + (pos.x || 0) + "px," + (pos.y || 0) + "px)",
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 12px",
            borderRadius: 999,
            background: "var(--dsw-alias-bg-overlay, rgba(22,22,27,0.92))",
            color: "var(--dsw-alias-label-primary, #e8e8ec)",
            border: "1px solid var(--dsw-alias-border-l1, #3a3a40)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
            fontSize: 12,
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            cursor: "grab",
            userSelect: "none",
            lineHeight: 1,
            // The BREATH lives in the chip's tint below, never here. Fading the whole pill also
            // faded its words: measured, the label dropped to 3.1:1 at the dim end of the cycle,
            // under the 4.5:1 floor. A status light may pulse; its text may not become unreadable.
            opacity: 1,
          },
        },
        React.createElement(
          "span",
          { style: { fontWeight: 700, letterSpacing: 0.2, opacity: 0.7 } },
          "domains",
        ),
        React.createElement(
          "span",
          {
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: label === "" ? "0" : "2px 8px",
              borderRadius: 999,
              background: pulsing && dim ? (chip.dimBg || chip.bg) : chip.bg,
              transition: "background 1.1s ease-in-out, box-shadow 1.1s ease-in-out",
              color: chip.fg,
              border: "1px solid " + chip.border,
              boxShadow: pulsing && dim ? (chip.glow === "none" ? "none" : chip.glow.replace(/0\.\d+\)$/, "0.5)")) : chip.glow,
              fontWeight: 650,
              fontSize: 11.5,
              whiteSpace: "nowrap",
            },
          },
          label,
          glyph ? React.createElement("span", null, glyph) : null,
        ),
      );
    }

    function apply(ctx) {
      const slots = ctx.slots;
      const interval = ctx.interval;
      // `order: 90` sits just left of cost-bubble (100). Same slot, so it lands beside the pill the
      // operator already knows.
      slots.inject("shell.overlay", () => slots.register(
        { name: "shell.overlay", id: "domain-watch", order: 90, label: "Domain watch" },
        (props) => React.createElement(DomainWatchPill, { ...props, interval: interval }),
      ));
    }

    // Exported for the test suite alone: the pill's decision must be callable without a DOM.
    exports.pillState = pillState;

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
