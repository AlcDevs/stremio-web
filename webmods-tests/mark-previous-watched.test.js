// Harness for utils/webmods/mark-previous-watched.js against a jsdom replica of
// the upstream Video row / Popup menu structure (hashed CSS-module classes).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEBMOD = fs.readFileSync(
    path.join(__dirname, '..', 'webmods', 'mark-previous-watched.js'),
    'utf8'
);

const H = {
    videoContainer: 'video-container-abc12',
    labelContainer: 'label-container-zz001',
    titleContainer: 'title-container-def34',
    upcomingWatched: 'upcoming-watched-container-ghi56',
    watched: 'watched-container-jkl78',
    menuContainer: 'menu-container-mno90',
    menuContent: 'context-menu-content-ItIFy',
    optionContainer: 'context-menu-option-container-KNVWj',
    optionLabel: 'context-menu-option-label-pqr12',
    buttonContainer: 'button-container-stu34',
    menuTitle: 'context-menu-title-aoWE4',
    seasonsLabel: 'seasons-popup-label-container-vwx56',
};

function makeVideos(season, count, watchedThrough) {
    const videos = [];
    for (let i = 1; i <= count; i++) {
        videos.push({
            id: `tt111:${season}:${i}`,
            title: `Episode ${i} title`,
            season,
            episode: i,
            released: `2020-0${season}-0${i}T00:00:00Z`,
            watched: i <= watchedThrough,
        });
    }
    return videos;
}

function buildDom({ videos, season, openRowIndex, extraStreamMenu = false, inDrawer = false, seasonsBar = true }) {
    const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    const { window } = dom;
    const doc = window.document;
    const app = doc.getElementById('app');

    const shown = videos.filter((v) => v.season === season).sort((a, b) => a.episode - b.episode);

    const listRoot = doc.createElement('div');
    listRoot.className = inDrawer ? 'side-drawer-xyz11' : 'videos-list-container-xyz22';
    app.appendChild(listRoot);

    if (seasonsBar) {
        const bar = doc.createElement('div');
        bar.className = inDrawer ? 'seasons-popup-uuu11' : 'seasons-bar-container-uuu22';
        const label = doc.createElement('div');
        label.className = `${H.seasonsLabel} ${H.buttonContainer}`;
        label.setAttribute('title', `Season ${season}`);
        const inner = doc.createElement('div');
        inner.className = 'label-uuu33';
        inner.textContent = `Season ${season}`;
        label.appendChild(inner);
        bar.appendChild(label);
        listRoot.appendChild(bar);
    }

    const container = doc.createElement('div');
    container.className = inDrawer ? 'videos-vvv11' : 'videos-container-vvv22';
    listRoot.appendChild(container);

    shown.forEach((v, idx) => {
        const row = doc.createElement('div');
        row.className = `${H.labelContainer} ${H.videoContainer} ${H.buttonContainer}`;
        row.setAttribute('tabindex', '0');

        const info = doc.createElement('div');
        info.className = 'info-container-www11';
        const title = doc.createElement('div');
        title.className = H.titleContainer;
        title.textContent = `${v.episode}. ${v.title}`;
        info.appendChild(title);

        const flags = doc.createElement('div');
        flags.className = H.upcomingWatched; // must NOT count as watched
        if (v.watched) {
            const w = doc.createElement('div');
            w.className = H.watched;
            const label = doc.createElement('div');
            label.className = 'flag-label-x';
            label.textContent = 'Watched';
            w.appendChild(label);
            flags.appendChild(w);
        }
        info.appendChild(flags);
        row.appendChild(info);

        if (idx === openRowIndex) {
            row.className += ' active';
            const menuContainer = doc.createElement('div');
            menuContainer.className = H.menuContainer;
            const menu = doc.createElement('div');
            menu.className = H.menuContent;
            ['Watch', v.watched ? 'Mark as non-watched' : 'Mark as watched', 'Mark rest as watched'].forEach((text) => {
                const opt = doc.createElement('div');
                opt.className = `${H.optionContainer} ${H.buttonContainer}`;
                opt.setAttribute('tabindex', '0');
                opt.setAttribute('title', text);
                const lbl = doc.createElement('div');
                lbl.className = H.optionLabel;
                lbl.textContent = text;
                opt.appendChild(lbl);
                menu.appendChild(opt);
            });
            menuContainer.appendChild(menu);
            row.appendChild(menuContainer);
        }
        container.appendChild(row);
    });

    if (extraStreamMenu) {
        const streamRow = doc.createElement('div');
        streamRow.className = 'stream-container-sss11 label-container-sss22';
        const mc = doc.createElement('div');
        mc.className = H.menuContainer;
        const menu = doc.createElement('div');
        menu.className = 'context-menu-content-Xe_lN';
        const t = doc.createElement('div');
        t.className = H.menuTitle;
        t.textContent = '1080p stream';
        menu.appendChild(t);
        ['Play', 'Copy stream link'].forEach((text) => {
            const opt = doc.createElement('div');
            opt.className = 'context-menu-option-container-BZGla';
            const lbl = doc.createElement('div');
            lbl.className = 'context-menu-option-label-zzz';
            lbl.textContent = text;
            opt.appendChild(lbl);
            menu.appendChild(opt);
        });
        mc.appendChild(menu);
        streamRow.appendChild(mc);
        app.appendChild(streamRow);
    }

    const dispatched = [];
    window.services = {
        core: {
            transport: {
                dispatch: (a) => dispatched.push(a),
                getState: (model) =>
                    Promise.resolve(
                        model === 'meta_details'
                            ? { metaItem: { content: { type: 'Ready', content: { videos } } } }
                            : { metaItem: { type: 'Ready', content: { videos } } }
                    ),
            },
        },
    };

    window.eval(WEBMOD);
    return { dom, window, doc, dispatched, container };
}

const tick = (window, ms) => new Promise((r) => window.setTimeout(r, ms));

function findInjected(doc) {
    return doc.querySelector('[data-community-mark-previous]');
}

let failures = 0;
function check(name, cond, extra) {
    if (cond) {
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}${extra ? ' -> ' + extra : ''}`);
    }
}

async function run() {
    // --- 1: episode 5 of a 10-episode season, nothing watched -----------
    {
        console.log('\n[1] meta details, menu open on episode 5, none watched');
        const videos = makeVideos(1, 10, 0).concat(makeVideos(2, 10, 0));
        const { window, doc, dispatched } = buildDom({ videos, season: 1, openRowIndex: 4 });
        await tick(window, 400);
        const opt = findInjected(doc);
        check('option injected', !!opt);
        check('label is "Mark previous as watched"', opt && opt.textContent === 'Mark previous as watched', opt && opt.textContent);
        check('appended last', opt && opt.parentElement.lastElementChild === opt);
        check('inherits upstream option classes', opt && opt.className.includes(H.optionContainer));

        opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(window, 50);
        check('4 dispatches (episodes 1-4)', dispatched.length === 4, `got ${dispatched.length}`);
        const ids = dispatched.map((d) => d.args.args[0].id);
        check('correct ids', JSON.stringify(ids) === JSON.stringify(['tt111:1:1', 'tt111:1:2', 'tt111:1:3', 'tt111:1:4']), ids.join(','));
        check('namespace MetaDetails', dispatched.every((d) => d.action === 'MetaDetails'));
        check('action MarkVideoAsWatched', dispatched.every((d) => d.args.action === 'MarkVideoAsWatched'));
        check('desired watched = true', dispatched.every((d) => d.args.args[1] === true));
        check('released passed through', dispatched[0].args.args[0].released === '2020-01-01T00:00:00Z', dispatched[0].args.args[0].released);
        check('no season-2 episode touched', ids.every((id) => id.startsWith('tt111:1:')));
    }

    // --- 2: first row -> no option ---------------------------------------
    {
        console.log('\n[2] menu open on episode 1 (nothing previous)');
        const videos = makeVideos(1, 10, 0);
        const { window, doc } = buildDom({ videos, season: 1, openRowIndex: 0 });
        await tick(window, 400);
        check('no option injected', !findInjected(doc));
    }

    // --- 3: all previous already watched -> toggle ------------------------
    {
        console.log('\n[3] menu open on episode 5, episodes 1-4 watched');
        const videos = makeVideos(1, 10, 4);
        const { window, doc, dispatched } = buildDom({ videos, season: 1, openRowIndex: 4 });
        await tick(window, 400);
        const opt = findInjected(doc);
        check('label toggles to non-watched', opt && opt.textContent === 'Mark previous as non-watched', opt && opt.textContent);
        opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(window, 50);
        check('4 unmark dispatches', dispatched.length === 4, `got ${dispatched.length}`);
        check('desired watched = false', dispatched.every((d) => d.args.args[1] === false));
    }

    // --- 4: partially watched -> mark only the unwatched ones -------------
    {
        console.log('\n[4] menu open on episode 5, episodes 1-2 watched');
        const videos = makeVideos(1, 10, 2);
        const { window, doc, dispatched } = buildDom({ videos, season: 1, openRowIndex: 4 });
        await tick(window, 400);
        const opt = findInjected(doc);
        check('label is "Mark previous as watched"', opt && opt.textContent === 'Mark previous as watched', opt && opt.textContent);
        opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(window, 50);
        const ids = dispatched.map((d) => d.args.args[0].id);
        check('only unwatched dispatched (3,4)', JSON.stringify(ids) === JSON.stringify(['tt111:1:3', 'tt111:1:4']), ids.join(','));
    }

    // --- 5: player side drawer -> Player namespace ------------------------
    {
        console.log('\n[5] player side drawer, menu open on episode 3');
        const videos = makeVideos(2, 6, 0);
        const { window, doc, dispatched } = buildDom({ videos, season: 2, openRowIndex: 2, inDrawer: true });
        await tick(window, 400);
        const opt = findInjected(doc);
        check('option injected', !!opt);
        opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(window, 50);
        check('namespace Player', dispatched.length > 0 && dispatched.every((d) => d.action === 'Player'), JSON.stringify(dispatched.map(d => d.action)));
        check('2 dispatches (episodes 1-2)', dispatched.length === 2, `got ${dispatched.length}`);
    }

    // --- 6: stream context menu untouched --------------------------------
    {
        console.log('\n[6] stream context menu present');
        const videos = makeVideos(1, 5, 0);
        const { window, doc } = buildDom({ videos, season: 1, openRowIndex: 2, extraStreamMenu: true });
        await tick(window, 400);
        const injected = doc.querySelectorAll('[data-community-mark-previous]');
        check('exactly one option injected', injected.length === 1, `got ${injected.length}`);
        check('injected inside the video menu', injected[0] && injected[0].parentElement.className.includes('context-menu-content-ItIFy'));
    }

    // --- 7: second season selected -> season resolved from row text -------
    {
        console.log('\n[7] season 2 shown, menu open on S2E4');
        const videos = makeVideos(1, 10, 0).concat(makeVideos(2, 10, 0));
        const { window, doc, dispatched } = buildDom({ videos, season: 2, openRowIndex: 3 });
        await tick(window, 400);
        findInjected(doc).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(window, 50);
        const ids = dispatched.map((d) => d.args.args[0].id);
        check('only season 2 episodes 1-3', JSON.stringify(ids) === JSON.stringify(['tt111:2:1', 'tt111:2:2', 'tt111:2:3']), ids.join(','));
    }

    // --- 8: same titles in both seasons and no season hint -> refuse to guess
    {
        console.log('\n[8] ambiguous season (identical titles, no seasons bar)');
        const videos = makeVideos(1, 10, 0).concat(makeVideos(2, 10, 0));
        const { window, doc } = buildDom({ videos, season: 2, openRowIndex: 3, seasonsBar: false });
        await tick(window, 400);
        check('no option injected when the season is ambiguous', !findInjected(doc));
    }

    // --- 9: core services not started yet -> no crash, no dead option -----
    {
        console.log('\n[9] core services not started yet');
        const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
            runScripts: 'outside-only', pretendToBeVisual: true,
        });
        const doc = dom.window.document;
        const container = doc.createElement('div');
        container.className = 'videos-container-vvv22';
        doc.getElementById('app').appendChild(container);
        [1, 2, 3].forEach((n) => {
            const row = doc.createElement('div');
            row.className = `${H.labelContainer} ${H.videoContainer}`;
            const t = doc.createElement('div');
            t.className = H.titleContainer;
            t.textContent = `${n}. Episode ${n} title`;
            row.appendChild(t);
            if (n === 3) {
                const mc = doc.createElement('div');
                mc.className = H.menuContainer;
                const menu = doc.createElement('div');
                menu.className = H.menuContent;
                const opt = doc.createElement('div');
                opt.className = H.optionContainer;
                opt.textContent = 'Watch';
                menu.appendChild(opt);
                mc.appendChild(menu);
                row.appendChild(mc);
            }
            container.appendChild(row);
        });
        let threw = null;
        try { dom.window.eval(WEBMOD); } catch (e) { threw = e; }
        await tick(dom.window, 300);
        check('no throw without window.services', !threw, threw && threw.message);
        check('no dead option without core state', !findInjected(doc));
    }

    // --- 10: an active episode search filter must not redefine "previous" ---
    {
        console.log('\n[10] only episodes 4-6 rendered, menu open on episode 5');
        const videos = makeVideos(1, 10, 0);
        const { window, doc, dispatched, container } = buildDom({ videos, season: 1, openRowIndex: 4 });
        // Keep only episodes 4,5,6 rendered, as the episode search filter does.
        Array.from(container.children).forEach((r, i) => { if (i < 3 || i > 5) r.remove(); });
        await tick(window, 400);
        const opt = findInjected(doc);
        check('option injected on the filtered list', !!opt);
        opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(window, 50);
        const ids = dispatched.map((d) => d.args.args[0].id);
        check('marks episodes 1-4, not only the rendered ones',
            JSON.stringify(ids) === JSON.stringify(['tt111:1:1', 'tt111:1:2', 'tt111:1:3', 'tt111:1:4']), ids.join(','));
    }

    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
