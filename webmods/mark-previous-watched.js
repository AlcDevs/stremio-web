// Stremio Community v5 Webmod: Mark Previous As Watched
//
// The episode row context menu (right-click / long-press) ships three options:
// "Watch", "Mark as watched" and "Mark rest as watched". This appends a fourth
// one, "Mark previous as watched", which marks every earlier episode of the
// currently selected season as watched (and toggles to "Mark previous as
// non-watched" once they all are).
//
// Works on the meta details episode list and on the player's side-drawer
// episode list; both render the same upstream Video component, only the core
// action namespace and the state model differ.
//
// The option is a clone of a real menu option, so it inherits the app's exact
// classes/styling, and the work is done through the app's own core action
// (MarkVideoAsWatched) via window.services.core.transport.
//
// Bounded design (no unbounded loops, no mutation feedback loops):
//  - exactly ONE MutationObserver (debounced; its writes are idempotent, so a
//    settled menu produces no further writes and cannot feed back on itself)
//  - per-menu listeners live on the injected node only and die with it
//  - NO setInterval, no recursive setTimeout chains (single trailing debounce
//    timer, replaced never stacked)
//  - state reads are cached with a short TTL and at most one in flight
//  - whole install guarded by a global marker (idempotent)

(function() {
    'use strict';
    if (window.top !== window) return;

    var INSTALL_KEY = '__stremioCommunityMarkPreviousInstalled';
    try {
        if (window[INSTALL_KEY]) return;
        window[INSTALL_KEY] = true;
    } catch (e) { return; }

    var MARK_ATTR = 'data-community-mark-previous';
    var DEBOUNCE_MS = 60;
    var STATE_TTL_MS = 1500; // core state cache lifetime

    var LABEL_WATCHED = 'Mark previous as watched';
    var LABEL_NON_WATCHED = 'Mark previous as non-watched';

    var state = {
        observer: null,
        checkTimer: null,
        cache: {}          // model -> { videos: [], at: <ms>, pending: bool }
    };

    console.log('[MarkPrevious] Webmod loaded v1');

    // ------------------------------------------------------------------
    // CSS-modules aware class matching. Upstream classes are hashed
    // ("video-container-a1b2c"), and substring matching alone is unsafe:
    // "watched-container" is a substring of "upcoming-watched-container".
    // So compare per class token: exact, or base + "-"/"_" + hash.
    // ------------------------------------------------------------------

    function hasClassToken(el, base) {
        var cls = '';
        try { cls = String((el && el.className) || ''); } catch (e) { return false; }
        if (!cls) return false;
        var tokens = cls.split(/\s+/);
        for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i];
            if (t === base) return true;
            if (t.length > base.length && t.indexOf(base) === 0) {
                var sep = t.charAt(base.length);
                if (sep === '-' || sep === '_') return true;
            }
        }
        return false;
    }

    // Nearest ancestor (self included) actually carrying the class token.
    function closestByToken(el, base) {
        var node = el;
        while (node && node.nodeType === 1) {
            if (hasClassToken(node, base)) return node;
            node = node.parentElement;
        }
        return null;
    }

    function childrenByToken(parent, base) {
        var out = [];
        if (!parent) return out;
        var children = parent.children;
        for (var i = 0; i < children.length; i++) {
            var c = children[i];
            if (c.nodeType === 1 && hasClassToken(c, base)) out.push(c);
        }
        return out;
    }

    function findByToken(root, base) {
        var out = [];
        var nodes;
        try { nodes = root.querySelectorAll('[class*="' + base + '"]'); } catch (e) { return out; }
        for (var i = 0; i < nodes.length; i++) {
            if (hasClassToken(nodes[i], base)) out.push(nodes[i]);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Core access. window.services is set by the app once its services are
    // started; every read is guarded because a webmod can run before that.
    // ------------------------------------------------------------------

    function getCoreTransport() {
        try {
            var core = window.services && window.services.core;
            if (core && core.transport && typeof core.transport.dispatch === 'function') {
                return core.transport;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    // The episode list exists in two places, backed by two different models.
    function getContext(row) {
        var drawer = null;
        try { drawer = row.closest('[class*="side-drawer"]'); } catch (e) { drawer = null; }
        if (drawer && !hasClassToken(drawer, 'side-drawer-button')) {
            return { model: 'player', action: 'Player' };
        }
        return { model: 'meta_details', action: 'MetaDetails' };
    }

    // meta_details keeps the meta behind a loadable inside a loadable
    // (metaItem.content.content), the player one level up (metaItem.content).
    function extractVideos(modelState) {
        var metaItem = modelState && modelState.metaItem;
        if (!metaItem) return null;
        var content = metaItem.content;
        if (!content) return null;
        if (Array.isArray(content.videos)) return content.videos;
        if (content.content && Array.isArray(content.content.videos)) return content.content.videos;
        return null;
    }

    // A cache entry is fresh for STATE_TTL_MS whether or not it found videos,
    // so a model that has none (a movie, a mismatched context) is not refetched
    // on every observer tick.
    function isFresh(entry) {
        if (!entry || !entry.at) return false;
        try { return (Date.now() - entry.at) <= STATE_TTL_MS; } catch (e) { return false; }
    }

    function getCachedVideos(model) {
        var entry = state.cache[model];
        return isFresh(entry) ? entry.videos : null;
    }

    // Refreshes the cached videos for a model; re-runs the menu update once the
    // fresh state lands so the label can settle on the real watched flags.
    function refreshVideos(model, onDone) {
        var entry = state.cache[model] || (state.cache[model] = { videos: null, at: 0, pending: false });
        if (entry.pending || isFresh(entry)) return;
        var transport = getCoreTransport();
        if (!transport || typeof transport.getState !== 'function') return;
        entry.pending = true;
        var settle = function(videos) {
            entry.pending = false;
            entry.videos = videos;
            try { entry.at = Date.now(); } catch (e) { entry.at = 0; }
            if (typeof onDone === 'function') {
                try { onDone(); } catch (e) { /* guarded */ }
            }
        };
        try {
            Promise.resolve(transport.getState(model)).then(function(modelState) {
                var videos = null;
                try { videos = extractVideos(modelState); } catch (e) { videos = null; }
                settle(videos);
            }, function() { settle(null); });
        } catch (e) {
            settle(null);
        }
    }

    // ------------------------------------------------------------------
    // Rows <-> videos. Video rows carry no usable DOM id (upstream destructures
    // `id` and never applies it), so rows are matched to core videos by the
    // rendered "<episode>. <title>" text, scoring each season and keeping the
    // best one. That also pins down which season the list is showing without
    // reading a localized season label.
    // ------------------------------------------------------------------

    function normalizeText(text) {
        return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    }

    function getRowInfo(row) {
        var titleEl = null;
        try { titleEl = row.querySelector('[class*="title-container"]'); } catch (e) { titleEl = null; }
        var text = '';
        try {
            text = normalizeText(titleEl ? titleEl.textContent : row.textContent);
        } catch (e) { text = ''; }
        var episode = null;
        var title = text;
        var m = /^(\d+)\.\s*/.exec(text);
        if (m) {
            episode = parseInt(m[1], 10);
            title = text.slice(m[0].length);
        }
        return { episode: episode, title: title };
    }

    // Which season the list is showing, when the app says so explicitly:
    // the meta details route query, else the digits in the season selector
    // label ("Season 2" keeps its number in every locale; "Special" has none,
    // and yields no hint rather than a guess).
    function readSeasonHint(row) {
        var hash = '';
        try { hash = window.location.hash || ''; } catch (e) { hash = ''; }
        var fromRoute = /[?&]season=(\d+)/.exec(hash);
        if (fromRoute) return parseInt(fromRoute[1], 10);

        var scope = null;
        try {
            scope = row.closest('[class*="side-drawer"]') || row.closest('[class*="videos-list-container"]');
        } catch (e) { scope = null; }
        var labels = findByToken(scope || document, 'seasons-popup-label-container');
        if (labels.length === 0) return null;
        var text = normalizeText(labels[0].textContent);
        if (!text) text = normalizeText(labels[0].getAttribute('title'));
        var digits = /(\d+)/.exec(text);
        return digits ? parseInt(digits[1], 10) : null;
    }

    function matchVideo(seasonVideos, info) {
        var byEpisode = [];
        var byTitle = null;
        for (var i = 0; i < seasonVideos.length; i++) {
            var v = seasonVideos[i];
            var episodeMatch = info.episode !== null && v.episode === info.episode;
            var vTitle = typeof v.title === 'string' ? normalizeText(v.title) : '';
            // Upstream falls back to rendering the video id when there is no
            // title, so accept either as the text half of the match.
            var titleMatch = info.title.length > 0 && (vTitle === info.title || v.id === info.title);
            if (episodeMatch && titleMatch) return v;
            if (episodeMatch) byEpisode.push(v);
            if (titleMatch && !byTitle) byTitle = v;
        }
        if (byEpisode.length === 1) return byEpisode[0];
        return byTitle;
    }

    function groupBySeason(videos) {
        var groups = [];
        var index = {};
        for (var i = 0; i < videos.length; i++) {
            var v = videos[i];
            var key = v && v.season == null ? 'null' : String(v.season);
            if (!index[key]) {
                index[key] = { season: v ? v.season : null, videos: [] };
                groups.push(index[key]);
            }
            index[key].videos.push(v);
        }
        return groups;
    }

    // Resolves the season the list is showing plus the clicked row's video.
    // Returns null unless the clicked row could be matched inside exactly one
    // best-scoring season: marking the wrong season's episodes as watched is
    // worse than doing nothing, so genuine ambiguity is refused, not guessed.
    function resolveSelection(rows, rowIndex, videos, seasonHint) {
        var infos = [];
        for (var i = 0; i < rows.length; i++) infos.push(getRowInfo(rows[i]));

        var groups = groupBySeason(videos);
        var candidates = [];
        for (var g = 0; g < groups.length; g++) {
            var seasonVideos = groups[g].videos;
            var matched = [];
            var score = 0;
            for (var r = 0; r < infos.length; r++) {
                var v = matchVideo(seasonVideos, infos[r]);
                matched.push(v);
                if (v) score++;
            }
            if (!matched[rowIndex]) continue; // useless without the clicked row
            candidates.push({
                season: groups[g].season,
                score: score,
                seasonVideos: seasonVideos,
                target: matched[rowIndex]
            });
        }
        if (candidates.length === 0) return null;

        if (seasonHint !== null && seasonHint !== undefined) {
            for (var c = 0; c < candidates.length; c++) {
                if (candidates[c].season === seasonHint) return candidates[c];
            }
        }
        candidates.sort(function(a, b) { return b.score - a.score; });
        if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
        return candidates[0];
    }

    // Earlier episodes of the same season, by episode number — deliberately not
    // by DOM position, so an active episode-search filter cannot change what
    // "previous" means. Episodes without a number are skipped.
    function previousVideos(seasonVideos, target) {
        var out = [];
        if (typeof target.episode !== 'number' || isNaN(target.episode)) return out;
        for (var i = 0; i < seasonVideos.length; i++) {
            var v = seasonVideos[i];
            if (v === target) continue;
            if (typeof v.episode !== 'number' || isNaN(v.episode)) continue;
            if (v.episode < target.episode) out.push(v);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // The injected menu option
    // ------------------------------------------------------------------

    // Closing goes through the app's own path: Popup closes on a window-level
    // pointerdown whose target sits outside the row it is anchored to.
    function closeOpenPopup() {
        try {
            document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
        } catch (e) { /* guarded */ }
    }

    function markPrevious(row, desiredWatched) {
        var transport = getCoreTransport();
        if (!transport) return;

        var context = getContext(row);
        var videos = getCachedVideos(context.model);
        if (!videos) {
            console.log('[MarkPrevious] No core videos available yet, skipping');
            return;
        }

        var container = row.parentElement;
        var rows = childrenByToken(container, 'video-container');
        var rowIndex = rows.indexOf(row);
        if (rowIndex < 0) return;

        var selection = resolveSelection(rows, rowIndex, videos, readSeasonHint(row));
        if (!selection) {
            console.log('[MarkPrevious] Could not match the episode row to core state, skipping');
            return;
        }

        var previous = previousVideos(selection.seasonVideos, selection.target);
        var changed = 0;
        for (var i = 0; i < previous.length; i++) {
            var v = previous[i];
            if (!v || typeof v.id !== 'string') continue;
            if (!!v.watched === !!desiredWatched) continue;
            transport.dispatch({
                action: context.action,
                args: {
                    action: 'MarkVideoAsWatched',
                    args: [{ id: v.id, released: v.released }, !!desiredWatched]
                }
            });
            changed++;
        }

        // The dispatches above changed watched flags the cache still describes.
        state.cache[context.model] = { videos: null, at: 0, pending: false };

        console.log('[MarkPrevious] Marked ' + changed + '/' + previous.length +
            ' previous episode(s) as ' + (desiredWatched ? 'watched' : 'non-watched'));
    }

    function optionLabelEl(option) {
        var labels = findByToken(option, 'context-menu-option-label');
        return labels.length > 0 ? labels[0] : option;
    }

    function setOptionLabel(option, text) {
        var labelEl = optionLabelEl(option);
        if (normalizeText(labelEl.textContent) !== text) labelEl.textContent = text;
        if (option.getAttribute('title') !== text) option.setAttribute('title', text);
    }

    // Whether the previous episodes are already all watched, so the option can
    // toggle like the upstream "Mark rest as watched" one does. null means
    // "offer nothing": no core state yet, an unresolvable row, or no earlier
    // episode to act on — the option is only ever shown when clicking it would
    // actually do something.
    function previousAllWatched(row, rows, rowIndex, videos) {
        if (!videos) return null;
        var selection = resolveSelection(rows, rowIndex, videos, readSeasonHint(row));
        if (!selection) return null;
        var previous = previousVideos(selection.seasonVideos, selection.target);
        if (previous.length === 0) return null;
        for (var i = 0; i < previous.length; i++) {
            if (!previous[i].watched) return false;
        }
        return true;
    }

    function createOption(template, row) {
        var option = template.cloneNode(true);
        option.setAttribute(MARK_ATTR, '1');
        // Upstream options are plain divs with tabIndex; the clone keeps the
        // classes and focusability but none of React's handlers, so wire ours.
        var activate = function(e) {
            e.preventDefault();
            e.stopPropagation();
            var desired = option.getAttribute('data-desired-watched') !== '0';
            closeOpenPopup();
            markPrevious(row, desired);
        };
        option.addEventListener('click', activate);
        option.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') activate(e);
        });
        return option;
    }

    // ------------------------------------------------------------------
    // Menu discovery + update
    // ------------------------------------------------------------------

    // The Video context menu: a "context-menu-content" with option rows, no
    // title row (that one belongs to the Stream menu), anchored inside an
    // episode row.
    function findVideoMenus() {
        var out = [];
        var menus = findByToken(document, 'context-menu-content');
        for (var i = 0; i < menus.length; i++) {
            var menu = menus[i];
            if (!menu.isConnected) continue;
            if (findByToken(menu, 'context-menu-title').length > 0) continue;
            var options = childrenByToken(menu, 'context-menu-option-container');
            if (options.length === 0) continue;
            var row = closestByToken(menu.parentElement, 'video-container');
            if (!row) continue;
            out.push({ menu: menu, options: options, row: row });
        }
        return out;
    }

    function updateMenu(entry) {
        var menu = entry.menu;
        var row = entry.row;
        var container = row.parentElement;
        var rows = childrenByToken(container, 'video-container');
        var rowIndex = rows.indexOf(row);
        if (rowIndex < 0) return;

        var context = getContext(row);
        var videos = getCachedVideos(context.model);
        if (!videos) refreshVideos(context.model, scheduleCheck);

        var allWatched = previousAllWatched(row, rows, rowIndex, videos);
        var existing = menu.querySelector('[' + MARK_ATTR + ']');

        if (allWatched === null) {
            // First episode of the season / nothing earlier to mark.
            if (existing) existing.remove();
            return;
        }

        var option = existing;
        if (!option) {
            var template = entry.options[entry.options.length - 1];
            option = createOption(template, row);
            menu.appendChild(option);
        }
        option.setAttribute('data-desired-watched', allWatched ? '0' : '1');
        setOptionLabel(option, allWatched ? LABEL_NON_WATCHED : LABEL_WATCHED);
    }

    function onMaybeChange() {
        var menus = findVideoMenus();
        for (var i = 0; i < menus.length; i++) {
            try { updateMenu(menus[i]); } catch (e) { /* guarded */ }
        }
    }

    function scheduleCheck() {
        if (state.checkTimer) clearTimeout(state.checkTimer);
        state.checkTimer = setTimeout(function() {
            state.checkTimer = null;
            onMaybeChange();
        }, DEBOUNCE_MS);
    }

    // Both ways of opening the menu (right-click, long-press) start with a
    // pointerdown on the row, so warm the state cache there: by the time the
    // menu mounts the option can be rendered with the menu instead of popping
    // in once an async state read lands.
    function onPointerDown(e) {
        var target = e.target;
        if (!target || target.nodeType !== 1) return;
        var row = closestByToken(target, 'video-container');
        if (!row) return;
        refreshVideos(getContext(row).model);
    }

    function startObserver() {
        if (state.observer) return;
        if (!document.body) return;
        state.observer = new MutationObserver(function() {
            scheduleCheck();
        });
        state.observer.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        try {
            startObserver();
            document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
            onMaybeChange(); // a menu may already be open at injection time
        } catch (e) { /* guarded */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
