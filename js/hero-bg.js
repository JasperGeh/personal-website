/* ============================================
   Interactive hero background (WebGL2)
   clouds  drifting clouds that part around the cursor (default)
   agar    reaction-diffusion colonies; the cursor streaks the plate
   Switch with the footer buttons or ?bg=clouds|agar|none
   ============================================ */

(() => {
    const MODES = ['clouds', 'agar'];
    const switcher = document.querySelector('.bg-switch');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const systemDark = matchMedia('(prefers-color-scheme: dark)');
    const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light')) === 'dark';

    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    const S = {
        base03: hex('#002b36'), base02: hex('#073642'), base01: hex('#586e75'),
        base1: hex('#93a1a1'), base2: hex('#eee8d5'), base3: hex('#fdf6e3'),
        yellow: hex('#b58900'), orange: hex('#cb4b16'), red: hex('#dc322f'),
        magenta: hex('#d33682'), blue: hex('#268bd2'), cyan: hex('#2aa198'), green: hex('#859900'),
    };

    const VERT = `#version 300 es
        in vec2 aPos;
        void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

    /* ---------- Pointer tracking (CSS px relative to the canvas) ---------- */

    let active = null; // { canvas, scene, destroy }
    const pointer = { x: -1e4, y: -1e4, inside: false, moved: false, down: false };
    function updatePointer(e) {
        if (!active) return;
        const r = active.canvas.getBoundingClientRect();
        pointer.x = e.clientX - r.left;
        pointer.y = e.clientY - r.top;
        pointer.inside = pointer.y > -50 && pointer.y < r.height + 50;
        pointer.moved = true;
    }
    window.addEventListener('pointermove', updatePointer, { passive: true });
    window.addEventListener('pointerdown', e => {
        if (e.target.closest?.('a, button')) return;
        updatePointer(e);
        pointer.down = true;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer.inside = false; });

    window.addEventListener('resize', () => {
        if (!active) return;
        active.scene.resize();
        if (reducedMotion.matches) active.scene.still();
    });
    window.addEventListener('themechange', () => {
        if (active && reducedMotion.matches) active.scene.still();
    });

    /* ---------- Mounting a scene on a fresh canvas ---------- */

    // Returns a handle, or null if this browser can't run the scene
    function mount(mode) {
        const canvas = document.createElement('canvas');
        canvas.className = 'hero-bg';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.prepend(canvas);

        const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
        let scene = null;
        if (gl) {
            try {
                scene = mode === 'agar' ? agar() : clouds();
            } catch (err) {
                console.warn('hero background unavailable:', err);
            }
        }
        if (!scene) {
            canvas.remove();
            return null;
        }

        let visible = true;
        const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
        observer.observe(canvas);

        let raf = 0;
        let last = performance.now();
        function frame(now) {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (visible) scene.frame(dt, now / 1000);
            raf = requestAnimationFrame(frame);
        }

        scene.resize();
        if (reducedMotion.matches) {
            scene.still();
        } else {
            raf = requestAnimationFrame(frame);
        }
        requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.add('ready')));

        return {
            canvas,
            scene,
            destroy() {
                cancelAnimationFrame(raf);
                observer.disconnect();
                canvas.classList.remove('ready'); // fades out via CSS
                setTimeout(() => {
                    gl.getExtension('WEBGL_lose_context')?.loseContext();
                    canvas.remove();
                }, 1200);
            },
        };

        /* ---------- WebGL helpers ---------- */

        function program(fragSrc) {
            const p = gl.createProgram();
            for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fragSrc]]) {
                const sh = gl.createShader(type);
                gl.shaderSource(sh, src);
                gl.compileShader(sh);
                if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
                gl.attachShader(p, sh);
            }
            gl.bindAttribLocation(p, 0, 'aPos');
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
            const uniforms = {};
            const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < n; i++) {
                const name = gl.getActiveUniform(p, i).name.replace('[0]', '');
                uniforms[name] = gl.getUniformLocation(p, name);
            }
            if (!fullscreenTriangle.ready) fullscreenTriangle();
            return { p, u: uniforms };
        }

        // One triangle covering the viewport
        function fullscreenTriangle() {
            gl.bindVertexArray(gl.createVertexArray());
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            fullscreenTriangle.ready = true;
        }

        function sizeCanvas(scale) {
            const w = Math.max(1, Math.round(canvas.clientWidth * scale));
            const h = Math.max(1, Math.round(canvas.clientHeight * scale));
            if (canvas.width === w && canvas.height === h) return false;
            canvas.width = w;
            canvas.height = h;
            return true;
        }

        /* ============================================
           Clouds
           ============================================ */

        function clouds() {
            const TRAIL = 16;
            const prog = program(`#version 300 es
                precision highp float;
                uniform vec2 uRes;          // canvas pixels
                uniform float uPxToCss;
                uniform float uTime;
                uniform vec3 uTrail[${TRAIL}]; // css px xy, strength z
                uniform vec3 uSkyTop, uSkyBottom, uCloud, uShade;
                uniform vec3 uGlowSky, uGlowCloud; // sunset tint (dark mode)
                uniform float uGlow;
                uniform vec2 uLight;           // direction (in noise space) the light comes from
                out vec4 outColor;

                float hash(vec2 p) {
                    p = fract(p * vec2(123.34, 456.21));
                    p += dot(p, p + 45.32);
                    return fract(p.x * p.y);
                }
                float noise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
                }
                float fbm(vec2 p) {
                    float v = 0.0, a = 0.5;
                    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
                    for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
                    return v;
                }
                float density(vec2 q, float t) {
                    vec2 w = vec2(fbm(q + vec2(0.0, t * 0.6)), fbm(q + vec2(5.2, 1.3) - t * 0.4));
                    return fbm(q + 1.4 * w);
                }

                void main() {
                    vec2 pos = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * uPxToCss;
                    float height = uRes.y * uPxToCss;

                    // The cursor (and its fading trail) pushes cloud outward and thins it
                    vec2 push = vec2(0.0);
                    float hole = 0.0;
                    for (int i = 0; i < ${TRAIL}; i++) {
                        vec2 d = pos - uTrail[i].xy;
                        float r2 = dot(d, d);
                        float f = uTrail[i].z * exp(-r2 / (2.0 * 90.0 * 90.0));
                        push += normalize(d + 1e-4) * f;
                        hole += f;
                    }
                    vec2 samplePos = pos - push * 70.0;

                    float t = uTime * 0.02;
                    vec2 q = samplePos / 300.0 + vec2(t * 1.5, 0.0);
                    float d = density(q, t);
                    float cover = smoothstep(0.4, 0.58, d) * (1.0 - 0.9 * clamp(hole, 0.0, 1.0));

                    // Cheap self-shadowing: denser toward the light = brighter
                    float toward = density(q + uLight, t);
                    float shade = clamp((d - toward) * 5.0 + 0.2, 0.0, 0.75);
                    vec3 cloud = mix(uCloud, uShade, shade);

                    float y = pos.y / height;
                    vec3 sky = mix(uSkyTop, uSkyBottom, smoothstep(0.0, 0.9, y));

                    // Sunset: a warm band low in the sky, and clouds lit from below
                    // more strongly the closer they sit to it
                    float band = exp(-pow((y - 0.55) / 0.3, 2.0));
                    sky = mix(sky, uGlowSky, uGlow * band);
                    float lit = uGlow * smoothstep(0.05, 0.75, y) * (1.0 - 0.6 * shade);
                    cloud = mix(cloud, uGlowCloud, lit);
                    outColor = vec4(mix(sky, cloud, cover), 1.0);
                }`);

            const trail = new Float32Array(TRAIL * 3);
            for (let i = 0; i < TRAIL; i++) trail[i * 3] = -1e4;
            let head = 1; // slot 0 is the live cursor; the rest form a ring buffer
            let lastDrop = { x: -1e4, y: -1e4 };
            const cursor = { x: -1e4, y: -1e4, s: 0 };
            let time = Math.random() * 100;

            function palette() {
                const none = { glow: 0, glowSky: S.base3, glowCloud: S.base3, light: [-0.02, -0.06] };
                return isDark()
                    ? {
                        skyTop: mix(S.base03, S.blue, 0.16),
                        skyBottom: S.base03,
                        cloud: mix(S.base02, S.base1, 0.28),
                        shade: mix(S.base03, S.base02, 0.5),
                        glow: 0.8,
                        glowSky: mix(S.base03, mix(S.orange, S.magenta, 0.5), 0.42),
                        glowCloud: mix(mix(S.orange, S.magenta, 0.2), S.yellow, 0.25),
                        light: [0.0, 0.06], // from the horizon below
                    }
                    : {
                        ...none,
                        skyTop: mix(S.base3, S.blue, 0.32),
                        skyBottom: S.base3,
                        cloud: mix(S.base3, [1, 1, 1], 0.7),
                        shade: mix(mix(S.base2, S.base1, 0.4), S.blue, 0.06),
                    };
            }

            function draw() {
                const c = palette();
                gl.viewport(0, 0, canvas.width, canvas.height);
                gl.useProgram(prog.p);
                gl.uniform2f(prog.u.uRes, canvas.width, canvas.height);
                gl.uniform1f(prog.u.uPxToCss, canvas.clientWidth / canvas.width);
                gl.uniform1f(prog.u.uTime, time);
                gl.uniform3fv(prog.u.uTrail, trail);
                gl.uniform3fv(prog.u.uSkyTop, c.skyTop);
                gl.uniform3fv(prog.u.uSkyBottom, c.skyBottom);
                gl.uniform3fv(prog.u.uCloud, c.cloud);
                gl.uniform3fv(prog.u.uShade, c.shade);
                gl.uniform3fv(prog.u.uGlowSky, c.glowSky);
                gl.uniform3fv(prog.u.uGlowCloud, c.glowCloud);
                gl.uniform1f(prog.u.uGlow, c.glow);
                gl.uniform2fv(prog.u.uLight, c.light);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }

            return {
                resize() { sizeCanvas(Math.min(devicePixelRatio, 2) * 0.5); },
                still() { draw(); },
                frame(dt) {
                    time += dt;

                    // Live cursor eases toward the pointer, so the hole lags softly
                    const k = 1 - Math.exp(-dt * 10);
                    if (cursor.s < 0.02) { cursor.x = pointer.x; cursor.y = pointer.y; }
                    cursor.x += (pointer.x - cursor.x) * k;
                    cursor.y += (pointer.y - cursor.y) * k;
                    cursor.s += ((pointer.inside ? 0.9 : 0) - cursor.s) * k;
                    trail.set([cursor.x, cursor.y, cursor.s], 0);

                    // Drop wake points as the cursor travels; they fade over ~2s
                    if (pointer.inside && Math.hypot(cursor.x - lastDrop.x, cursor.y - lastDrop.y) > 40) {
                        trail.set([cursor.x, cursor.y, 0.6], head * 3);
                        head = head + 1 >= TRAIL ? 1 : head + 1;
                        lastDrop = { x: cursor.x, y: cursor.y };
                    }
                    for (let i = 1; i < TRAIL; i++) trail[i * 3 + 2] *= Math.exp(-dt * 1.4);

                    draw();
                },
            };
        }

        /* ============================================
           Agar plate (Gray-Scott reaction-diffusion)
           ============================================ */

        function agar() {
            if (!gl.getExtension('EXT_color_buffer_float')) return null;

            const CELL = 1.6;        // css px per simulation cell
            const STEPS = 10;        // simulation steps per frame
            const MAX_SEEDS = 8;

            const sim = program(`#version 300 es
                precision highp float;
                uniform sampler2D uState;
                uniform vec2 uTexel;
                uniform vec4 uSeeds[${MAX_SEEDS}]; // cell xy, radius, strength
                out vec4 outState;

                float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
                float noise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
                }

                void main() {
                    vec2 uv = gl_FragCoord.xy * uTexel;
                    vec2 c = texture(uState, uv).rg;
                    vec2 lap = -c
                        + 0.2 * (texture(uState, uv + vec2(uTexel.x, 0)).rg + texture(uState, uv - vec2(uTexel.x, 0)).rg
                               + texture(uState, uv + vec2(0, uTexel.y)).rg + texture(uState, uv - vec2(0, uTexel.y)).rg)
                        + 0.05 * (texture(uState, uv + uTexel).rg + texture(uState, uv - uTexel).rg
                                + texture(uState, uv + vec2(uTexel.x, -uTexel.y)).rg + texture(uState, uv + vec2(-uTexel.x, uTexel.y)).rg);

                    // Patchy "nutrients": growth stalls where kill rate is high,
                    // so colonies stay islands instead of carpeting the plate
                    vec2 cell = gl_FragCoord.xy;
                    float nutrients = noise(cell / 70.0) * 0.65 + noise(cell / 23.0) * 0.35;
                    float feed = 0.0545;
                    float kill = 0.062 + 0.0075 * smoothstep(0.5, 0.75, nutrients);

                    float a = c.r, b = c.g;
                    float abb = a * b * b;
                    vec2 next = c + vec2(1.0 * lap.x - abb + feed * (1.0 - a),
                                         0.5 * lap.y + abb - (kill + feed) * b);

                    for (int i = 0; i < ${MAX_SEEDS}; i++) {
                        vec4 s = uSeeds[i];
                        if (s.w > 0.0 && distance(cell, s.xy) < s.z) next = vec2(0.5, max(next.y, 0.25 * s.w));
                    }
                    outState = vec4(clamp(next, 0.0, 1.0), 0.0, 1.0);
                }`);

            const show = program(`#version 300 es
                precision highp float;
                uniform sampler2D uState;
                uniform vec2 uRes;
                uniform vec3 uEdge, uCore, uGlint;
                uniform float uAlpha;
                uniform float uColumn; // half-width of the text column, canvas px
                out vec4 outColor;

                void main() {
                    vec2 uv = gl_FragCoord.xy / uRes;
                    vec2 px = 1.0 / uRes;
                    float v = texture(uState, uv).g;

                    // Treat concentration as height to get a raised, glossy colony look
                    float dx = texture(uState, uv + vec2(px.x, 0)).g - texture(uState, uv - vec2(px.x, 0)).g;
                    float dy = texture(uState, uv + vec2(0, px.y)).g - texture(uState, uv - vec2(0, px.y)).g;
                    vec3 n = normalize(vec3(-dx * 6.0, -dy * 6.0, 1.0));
                    float light = dot(n, normalize(vec3(-0.5, 0.6, 0.6)));
                    float glint = pow(max(light, 0.0), 12.0);

                    float body = smoothstep(0.12, 0.3, v);
                    vec3 col = mix(uEdge, uCore, smoothstep(0.2, 0.38, v));
                    col *= 0.85 + 0.25 * light;
                    col = mix(col, uGlint, glint * 0.6 * body);
                    float fromCenter = abs(gl_FragCoord.x - uRes.x * 0.5);
                    float column = smoothstep(uColumn - 40.0, uColumn + 120.0, fromCenter);
                    float a = body * uAlpha * mix(0.18, 1.0, column);
                    outColor = vec4(col * a, a);
                }`);

            let textures = [], fbos = [], simW = 0, simH = 0, current = 0;
            const seeds = new Float32Array(MAX_SEEDS * 4);
            let seedCount = 0;
            let lastSeed = { x: -1e4, y: -1e4 };

            function makeState(w, h) {
                textures.forEach(t => gl.deleteTexture(t));
                fbos.forEach(f => gl.deleteFramebuffer(f));
                const init = new Float32Array(w * h * 4);
                for (let i = 0; i < w * h; i++) init[i * 4] = 1; // all substrate, no colonies
                textures = [0, 1].map(() => {
                    const t = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, t);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, init);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    return t;
                });
                fbos = textures.map(t => {
                    const f = gl.createFramebuffer();
                    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
                    return f;
                });
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                simW = w;
                simH = h;
                current = 0;

                // Inoculate a handful of colonies to start with
                const n = Math.max(5, Math.round(w / 90));
                for (let i = 0; i < n; i++) {
                    addSeed(Math.random() * w, h * (0.1 + Math.random() * 0.7), 3 + Math.random() * 3);
                }
            }

            function addSeed(x, y, r, strength = 1) {
                if (seedCount >= MAX_SEEDS) step(1); // flush queued seeds
                seeds.set([x, y, r, strength], seedCount * 4);
                seedCount++;
            }

            function cssToCell(x, y) {
                return [x / CELL, simH - y / CELL];
            }

            function step(n) {
                gl.viewport(0, 0, simW, simH);
                gl.useProgram(sim.p);
                gl.uniform2f(sim.u.uTexel, 1 / simW, 1 / simH);
                gl.activeTexture(gl.TEXTURE0);
                gl.uniform1i(sim.u.uState, 0);
                for (let i = 0; i < n; i++) {
                    gl.uniform4fv(sim.u.uSeeds, seeds);
                    gl.bindTexture(gl.TEXTURE_2D, textures[current]);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[1 - current]);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    current = 1 - current;
                    if (seedCount) { seeds.fill(0); seedCount = 0; }
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            }

            function palette() {
                return isDark()
                    ? { edge: S.cyan, core: S.green, glint: S.base3, alpha: 0.42 }
                    : { edge: S.cyan, core: S.green, glint: S.base3, alpha: 0.5 };
            }

            function draw() {
                const c = palette();
                gl.viewport(0, 0, canvas.width, canvas.height);
                gl.useProgram(show.p);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, textures[current]);
                gl.uniform1i(show.u.uState, 0);
                gl.uniform2f(show.u.uRes, canvas.width, canvas.height);
                gl.uniform3fv(show.u.uEdge, c.edge);
                gl.uniform3fv(show.u.uCore, c.core);
                gl.uniform3fv(show.u.uGlint, c.glint);
                gl.uniform1f(show.u.uAlpha, c.alpha);
                gl.uniform1f(show.u.uColumn, 360 * canvas.width / canvas.clientWidth);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }

            return {
                resize() {
                    sizeCanvas(Math.min(devicePixelRatio, 2));
                    const w = Math.round(canvas.clientWidth / CELL);
                    const h = Math.round(canvas.clientHeight / CELL);
                    if (w !== simW || h !== simH) makeState(w, h);
                },
                still() {
                    if (!this.grown) { step(4000); this.grown = true; }
                    draw();
                },
                frame() {
                    // Streak the plate: drop inoculum along the cursor's path
                    if (pointer.inside && pointer.moved) {
                        const dist = Math.hypot(pointer.x - lastSeed.x, pointer.y - lastSeed.y);
                        if (dist > 14) {
                            const [x, y] = cssToCell(pointer.x, pointer.y);
                            addSeed(x, y, 3);
                            lastSeed = { x: pointer.x, y: pointer.y };
                        }
                        pointer.moved = false;
                    }
                    if (pointer.down) {
                        const [x, y] = cssToCell(pointer.x, pointer.y);
                        if (pointer.inside) addSeed(x, y, 7);
                        pointer.down = false;
                    }
                    step(STEPS);
                    draw();
                },
            };
        }
    }

    /* ---------- Switching ---------- */

    function readSaved() {
        try { return localStorage.getItem('bg'); } catch (e) { return null; }
    }

    function setMode(mode, { remember = true } = {}) {
        if (active?.mode === mode) return;
        if (active) active.destroy();
        active = null;
        if (mode !== 'none') {
            active = mount(mode);
            if (!active && mode !== 'clouds') {
                // e.g. no float render targets for agar: hide that option
                switcher?.querySelector(`[data-bg="${mode}"]`)?.setAttribute('hidden', '');
                return setMode('clouds', { remember: false });
            }
            if (active) active.mode = mode;
        }
        if (!active && mode !== 'none') switcher?.setAttribute('hidden', '');

        switcher?.querySelectorAll('[data-bg]').forEach(btn => {
            btn.setAttribute('aria-pressed', btn.dataset.bg === mode);
        });
        if (remember) {
            try { localStorage.setItem('bg', mode); } catch (e) {}
            // Keep the choice in the URL so it can be shared
            const url = new URL(location.href);
            url.searchParams.set('bg', mode);
            history.replaceState(history.state, '', url);
        }
    }

    switcher?.addEventListener('click', e => {
        const btn = e.target.closest('[data-bg]');
        if (btn) setMode(btn.dataset.bg);
    });

    const requested = new URLSearchParams(location.search).get('bg') || readSaved();
    setMode(MODES.includes(requested) || requested === 'none' ? requested : 'clouds', { remember: false });
})();
