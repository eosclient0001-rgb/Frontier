/**
 * WebGPU capability probe.
 *
 * "WebGPU required" on its own is a dead end — it does not say whether the API
 * is missing, the adapter could not be created, or the device request failed.
 * Those have completely different fixes. This walks each stage in order and
 * reports exactly where it stopped, what the browser actually reports, and the
 * specific next step.
 */

export interface Diagnosis {
  ok: boolean;
  /** Which stage failed: 'api' | 'adapter' | 'device' | 'canvas' | none. */
  stage: string;
  headline: string;
  detail: string;
  /** Ordered, actionable remedies for this exact failure. */
  steps: string[];
  /** Raw environment facts, always shown so we can debug together. */
  facts: Array<[string, string]>;
}

function browserGuess(): { name: string; os: string; ua: string } {
  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; brands?: Array<{ brand: string; version: string }> } };

  let os = nav.userAgentData?.platform ?? '';
  if (!os) {
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Linux/i.test(ua)) os = 'Linux';
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    else os = 'unknown';
  }

  let name = 'unknown';
  const brands = nav.userAgentData?.brands;
  if (brands?.length) {
    const real = brands.find((b) => !/Not.?A.?Brand/i.test(b.brand));
    if (real) name = `${real.brand} ${real.version}`;
  }
  if (name === 'unknown') {
    const m =
      ua.match(/Edg\/([\d.]+)/) ? `Edge ${ua.match(/Edg\/([\d.]+)/)![1]}` :
      ua.match(/OPR\/([\d.]+)/) ? `Opera ${ua.match(/OPR\/([\d.]+)/)![1]}` :
      ua.match(/Firefox\/([\d.]+)/) ? `Firefox ${ua.match(/Firefox\/([\d.]+)/)![1]}` :
      ua.match(/Chrome\/([\d.]+)/) ? `Chrome ${ua.match(/Chrome\/([\d.]+)/)![1]}` :
      ua.match(/Version\/([\d.]+).*Safari/) ? `Safari ${ua.match(/Version\/([\d.]+).*Safari/)![1]}` :
      'unknown';
    name = m;
  }
  return { name, os, ua };
}

/**
 * Linux Chrome is by far the most common failure, and the fix depends on
 * whether Vulkan is reachable. WebGPU is an API, not a driver: on Linux and
 * Android it is implemented on top of Vulkan (on Windows D3D12, on macOS
 * Metal), which is why a Vulkan flag appears in a WebGPU error message.
 */
function linuxChromeSteps(): string[] {
  return [
    'Open chrome://flags and set "Unsafe WebGPU Support" (#enable-unsafe-webgpu) to Enabled, then relaunch.',
    'If that alone does not work, also set "Vulkan" (#enable-vulkan) to Enabled.',
    'Or launch from a terminal with: google-chrome --enable-unsafe-webgpu --enable-features=Vulkan',
    'Check chrome://gpu — find the "WebGPU" row. It states the exact reason it is disabled (often a blocklisted or too-old GPU driver).',
    'If chrome://gpu reports a driver problem, updating the Mesa / NVIDIA driver is the real fix.',
  ];
}

export async function diagnose(): Promise<Diagnosis> {
  const env = browserGuess();
  const facts: Array<[string, string]> = [
    ['Browser', env.name],
    ['Platform', env.os],
    ['Secure context', String(window.isSecureContext)],
  ];

  const isLinux = /Linux|X11|CrOS/i.test(env.os) || /Linux|X11/i.test(env.ua);
  const isChromium = /Chrome|Chromium|Edge|Edg|Opera|OPR/i.test(env.name) || /Chrome\//.test(env.ua);
  const isFirefox = /Firefox/i.test(env.name);
  const isSafari = /Safari/i.test(env.name) && !isChromium;

  // ---- stage 1: is the API even exposed? ---------------------------------
  if (!('gpu' in navigator)) {
    facts.push(['navigator.gpu', 'undefined']);

    const steps: string[] = [];
    let detail =
      'This browser does not expose the WebGPU API at all. Nothing about the terrain code has run yet — ' +
      'the very first check failed.';

    if (!window.isSecureContext) {
      steps.push(
        'This page is not a secure context. WebGPU is only exposed over HTTPS or on localhost. ' +
        'Open the preview over its https:// URL rather than a plain http:// IP address.',
      );
    }
    if (isLinux && isChromium) {
      detail += ' On Linux, Chromium ships WebGPU behind a flag more often than on other platforms.';
      steps.push(...linuxChromeSteps());
    } else if (isFirefox) {
      steps.push(
        'Firefox enables WebGPU by default from 141 on Windows only. On Linux/macOS open about:config and set dom.webgpu.enabled = true.',
        'Firefox Nightly has the most complete WebGPU implementation.',
      );
    } else if (isSafari) {
      steps.push(
        'Safari 26+ (macOS Tahoe / iOS 26) supports WebGPU. On older Safari enable Develop → Feature Flags → WebGPU.',
      );
    } else if (isChromium) {
      steps.push(
        'Chrome/Edge 113 or newer is required. Check your version at chrome://version.',
        'If the version is new enough, enable #enable-unsafe-webgpu at chrome://flags.',
      );
    } else {
      steps.push('Use Chrome or Edge 113+, which have the most complete WebGPU support.');
    }
    steps.push('As a fallback, any Chromium 113+ on Windows or macOS will run this out of the box.');

    return {
      ok: false, stage: 'api',
      headline: 'This browser does not expose WebGPU',
      detail, steps, facts,
    };
  }

  facts.push(['navigator.gpu', 'present']);
  const preferred = (() => {
    try { return navigator.gpu.getPreferredCanvasFormat(); } catch { return 'n/a'; }
  })();
  facts.push(['Preferred format', preferred]);

  // ---- stage 2: adapter ---------------------------------------------------
  let adapter: GPUAdapter | null = null;
  let adapterErr = '';
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      // Retry with no hint — some setups only expose a low-power/software one.
      adapter = await navigator.gpu.requestAdapter();
    }
    if (!adapter) {
      adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      if (adapter) facts.push(['Adapter', 'fallback (software) only']);
    }
  } catch (e) {
    adapterErr = e instanceof Error ? e.message : String(e);
  }

  if (!adapter) {
    facts.push(['requestAdapter()', adapterErr ? `threw: ${adapterErr}` : 'returned null']);
    const steps: string[] = [];
    if (isLinux && isChromium) steps.push(...linuxChromeSteps());
    else {
      steps.push(
        'Visit chrome://gpu (or about:support in Firefox) and look for the WebGPU status line — it gives the precise reason.',
        'Update your GPU driver; a blocklisted driver is the usual cause.',
        'On a laptop with switchable graphics, make sure the browser is not pinned to an unsupported integrated GPU.',
      );
    }
    return {
      ok: false, stage: 'adapter',
      headline: 'WebGPU is present, but no GPU adapter could be created',
      detail:
        'The browser exposes the API but refused to hand out an adapter. This is almost always a driver ' +
        'or flag issue rather than anything to do with this application.',
      steps, facts,
    };
  }

  const ai = (adapter as unknown as { info?: GPUAdapterInfo }).info;
  if (ai) {
    const desc = [ai.vendor, ai.architecture, ai.device, ai.description].filter(Boolean).join(' ');
    if (desc.trim()) facts.push(['Adapter', desc]);
  }
  // isFallbackAdapter was dropped from newer typings but is still present
  // at runtime in several implementations, so read it defensively.
  const fb = (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter;
  if (fb !== undefined) facts.push(['Fallback adapter', String(fb)]);

  const lim = adapter.limits;
  facts.push(['maxTextureDimension3D', String(lim.maxTextureDimension3D)]);
  facts.push(['maxStorageBufferBindingSize', `${(lim.maxStorageBufferBindingSize / 1048576).toFixed(0)} MB`]);
  facts.push(['maxBufferSize', `${(lim.maxBufferSize / 1048576).toFixed(0)} MB`]);

  // ---- stage 3: device ----------------------------------------------------
  let device: GPUDevice | null = null;
  let deviceErr = '';
  try {
    device = await adapter.requestDevice();
  } catch (e) {
    deviceErr = e instanceof Error ? e.message : String(e);
  }

  if (!device) {
    facts.push(['requestDevice()', deviceErr || 'returned null']);
    return {
      ok: false, stage: 'device',
      headline: 'A GPU adapter exists, but the device request failed',
      detail: deviceErr || 'requestDevice() did not return a device.',
      steps: [
        'Close other GPU-heavy tabs or applications and reload — this can be an out-of-memory condition.',
        'Try the Low grid preset once the app loads; the default volume pair is about 86 MB.',
      ],
      facts,
    };
  }

  // ---- stage 4: canvas context -------------------------------------------
  const probe = document.createElement('canvas');
  const ctx = probe.getContext('webgpu');
  if (!ctx) {
    facts.push(['canvas webgpu context', 'null']);
    return {
      ok: false, stage: 'canvas',
      headline: 'WebGPU works, but the canvas would not give a webgpu context',
      detail: 'getContext("webgpu") returned null even though a device was created.',
      steps: ['Reload the page.', 'Disable browser extensions that wrap or block canvas access.'],
      facts,
    };
  }

  device.destroy();
  return {
    ok: true, stage: '',
    headline: 'WebGPU is available',
    detail: '',
    steps: [],
    facts,
  };
}

/** Render a diagnosis into the gate element. */
export function renderDiagnosis(d: Diagnosis, extra?: string) {
  const gate = document.getElementById('gate');
  const card = gate?.querySelector('.gate-card');
  if (!gate || !card) return;

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  card.innerHTML = `
    <h1>${esc(d.headline)}</h1>
    ${extra ? `<p class="err">${esc(extra)}</p>` : ''}
    ${d.detail ? `<p>${esc(d.detail)}</p>` : ''}
    ${d.steps.length ? `<p class="lead">Try this, in order:</p><ol>${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    <details open>
      <summary>What your browser reports</summary>
      <table>${d.facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    </details>
    <p class="dim note">
      WebGPU is an API, not a driver — it runs on top of D3D12 on Windows, Metal on macOS and
      <b>Vulkan on Linux/Android</b>. That is why a Vulkan flag can appear in a WebGPU error message:
      Chrome needs its Vulkan backend to reach the GPU on Linux.
    </p>
    <p class="dim"><button id="gate-retry">Retry</button></p>
  `;

  const retry = document.getElementById('gate-retry');
  if (retry) retry.addEventListener('click', () => location.reload());
  gate.hidden = false;
}
