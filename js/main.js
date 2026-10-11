const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ============================================
   Sequence scramble: text decodes through ACGT
   ============================================ */

const SCRAMBLE_CHARS = 'ACGT';

function escapeHtml(str) {
    return str.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function randomBase() {
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

// Morph el's text into `to`. Each character flickers through bases for a
// moment before resolving, roughly left to right. With `lockWidth`, the
// element keeps its width so neighbours (and the nav indicator) don't jitter.
function scramble(el, to, { frames = 40, lockWidth = false } = {}) {
    cancelAnimationFrame(el._scrambleRaf);
    if (el._scrambleUnlock) el._scrambleUnlock();

    if (reducedMotion.matches) {
        el.textContent = to;
        return;
    }

    const from = el.textContent;
    const len = Math.max(from.length, to.length);
    const queue = [];
    for (let i = 0; i < len; i++) {
        const start = Math.floor((i / len) * frames * 0.45 + Math.random() * frames * 0.35);
        const end = start + Math.floor(4 + Math.random() * frames * 0.4);
        queue.push({ from: from[i] || '', to: to[i] || '', start, end, char: randomBase() });
    }

    if (lockWidth) {
        el.style.width = el.getBoundingClientRect().width + 'px';
        el.style.display = 'inline-block';
        el._scrambleUnlock = () => {
            el.style.width = '';
            el.style.display = '';
            el._scrambleUnlock = null;
        };
    }

    const t0 = performance.now();
    const tick = now => {
        const frame = (now - t0) / 16.7;
        let html = '';
        let done = 0;
        for (const q of queue) {
            if (frame >= q.end) {
                done++;
                html += escapeHtml(q.to);
            } else if (frame >= q.start) {
                if (q.to === ' ') {
                    html += ' ';
                } else {
                    if (Math.random() < 0.3) q.char = randomBase();
                    html += `<span class="scramble-char">${q.char}</span>`;
                }
            } else {
                html += escapeHtml(q.from);
            }
        }
        el.innerHTML = html;
        if (done === queue.length) {
            el.textContent = to;
            if (el._scrambleUnlock) el._scrambleUnlock();
        } else {
            el._scrambleRaf = requestAnimationFrame(tick);
        }
    };
    el._scrambleRaf = requestAnimationFrame(tick);
}

/* ============================================
   "Currently ..." rotation
   ============================================ */

const things = [
    "testing LLM refusals.",
    "GMing omnicidal elves.",
    "looking at planes.",
    "pondering red-line capabilities.",
    "wishing for biohardened cities.",
    "an ELBI fellow.",
    "taking photographs of clouds.",
    "predicting experimental outcomes.",
    "considering getting a dog.",
    "boarding planes.",
    "3D printing.",
    "hoarding stickers.",
    "re-reading Aposimz.",
    "procrastinating.",
    "a Foresight fellow.",
    "wishing all sentient beings well.",
    "exploring weird music.",
    "not missing pipetting.",
    "trying to get rid of coins.",
    "fixing bugs.",
    "tracking my vitals.",
    "finishing the dashboard.",
    "donating money.",
    "yearning."
];
const ROTATE_MS = 3500;

const rotatingEl = document.getElementById('rotating-text');
let thingIndex = 0;

function showNextThing() {
    scramble(rotatingEl, things[thingIndex]);
    thingIndex = (thingIndex + 1) % things.length;
}

rotatingEl.textContent = '';
showNextThing();
setInterval(showNextThing, ROTATE_MS);

/* ============================================
   Tab navigation + sliding indicator
   ============================================ */

const nav = document.querySelector('.nav');
const allNavLinks = nav.querySelectorAll('a');
const navLinks = nav.querySelectorAll('a[href^="#"]');
const sections = document.querySelectorAll('.section');
const indicator = nav.querySelector('.nav-indicator');

function activeLink() {
    return nav.querySelector('a.active');
}

function moveIndicator(link, { instant = false } = {}) {
    if (!link) {
        indicator.style.width = '0px';
        return;
    }
    if (instant) indicator.style.transition = 'none';
    indicator.style.width = link.offsetWidth + 'px';
    indicator.style.transform = `translate(${link.offsetLeft}px, ${link.offsetTop + link.offsetHeight}px)`;
    if (instant) {
        void indicator.offsetWidth;
        indicator.style.transition = '';
    }
}

function showSection(hash) {
    const targetId = hash.replace('#', '') || 'about';

    sections.forEach(section => {
        section.classList.toggle('active', section.id === targetId);
    });

    navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === '#' + targetId);
    });

    moveIndicator(activeLink());
}

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const hash = link.getAttribute('href');
        history.pushState(null, '', hash);
        showSection(hash);
    });
});

allNavLinks.forEach(link => {
    const label = link.textContent;
    link.addEventListener('mouseenter', () => {
        moveIndicator(link);
        scramble(link, label, { frames: 24, lockWidth: true });
    });
    link.addEventListener('focus', () => moveIndicator(link));
});
nav.addEventListener('mouseleave', () => moveIndicator(activeLink()));
nav.addEventListener('focusout', () => moveIndicator(activeLink()));

window.addEventListener('popstate', () => showSection(window.location.hash));
window.addEventListener('resize', () => moveIndicator(activeLink(), { instant: true }));

showSection(window.location.hash);
moveIndicator(activeLink(), { instant: true });
document.fonts.ready.then(() => {
    moveIndicator(activeLink(), { instant: true });
    indicator.classList.add('ready');
    allNavLinks.forEach((link, i) => {
        setTimeout(() => scramble(link, link.textContent, { frames: 36, lockWidth: true }), 250 + i * 70);
    });
});

/* ============================================
   Light / dark toggle
   ============================================ */

const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const themeToggle = document.querySelector('.theme-toggle');

function currentTheme() {
    return root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
}

function syncToggle() {
    themeToggle.setAttribute('aria-pressed', currentTheme() === 'dark');
}

function setTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch (e) {}
    syncToggle();
    window.dispatchEvent(new CustomEvent('themechange'));
}

themeToggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';

    if (!document.startViewTransition || reducedMotion.matches) {
        setTheme(next);
        return;
    }

    // Reveal the new theme as a circle growing out of the toggle
    const r = themeToggle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const transition = document.startViewTransition(() => setTheme(next));
    transition.ready.then(() => {
        root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
    });
});

systemDark.addEventListener('change', () => {
    if (!root.dataset.theme) {
        syncToggle();
        window.dispatchEvent(new CustomEvent('themechange'));
    }
});

syncToggle();
