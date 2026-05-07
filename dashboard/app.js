// ── BLE service / characteristic UUIDs ───────────────────────
// These must match exactly what's in the firmware
const SERVICE_UUID      = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_LIVE_UUID    = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const CHAR_SQUEEZE_UUID = 'd5f782b0-7236-4e20-8f2a-1e5e3a1c6b4d';
const CHAR_STATUS_UUID  = '8a7f1168-48af-4efb-83b5-0168e2070264';

// ── School day periods ────────────────────────────────────────
// Edit these if the class schedule changes
const PERIODS = [
  { name: 'Morning Work',   start: '8:00',  end: '8:45'  },
  { name: 'Reading',        start: '8:45',  end: '9:30'  },
  { name: 'Math',           start: '9:30',  end: '10:15' },
  { name: 'Recess',         start: '10:15', end: '10:45' },
  { name: 'Science',        start: '10:45', end: '11:30' },
  { name: 'Lunch',          start: '11:30', end: '12:15' },
  { name: 'Writing',        start: '12:15', end: '1:00'  },
  { name: 'Social Studies', start: '1:00',  end: '1:45'  },
  { name: 'Specials',       start: '1:45',  end: '2:30'  },
];

// ── App state ─────────────────────────────────────────────────
const MAX_HIST = 300;  // 30 seconds of history at 10 Hz

let balls          = {};    // all connected balls, keyed by generated ID
let selectedBallId = null;  // which ball is shown in Live / Day view
let isDemo         = false;
let sessionStart   = null;
let timerInterval  = null;
let animRunning    = false;

// Canvas references (set up in initCanvases)
let liveCtx, liveCanvasW = 0, liveCanvasH = 0;


// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function genId() {
  return Math.random().toString(36).slice(2);
}

// Create a new ball object and add it to the balls map
function createBall(id, name, color, squeezes, peak, battery) {
  balls[id] = {
    id,
    name,
    color,
    squeezes,
    peak,
    battery,
    livePressure: 0,
    inSqueeze:    false,
    history:      [],
    events:       [],
    periodData:   PERIODS.map(p => ({ ...p, count: 0, totalPressure: 0 })),
  };
}


// ─────────────────────────────────────────────────────────────
// CANVAS SETUP
// ─────────────────────────────────────────────────────────────

function initCanvases() {
  const canvas = document.getElementById('liveCanvas');
  liveCtx = canvas.getContext('2d');
  sizeLive();
  animRunning = true;
  requestAnimationFrame(drawLive);
}

// Resize the live canvas to match its container (called on load + window resize)
function sizeLive() {
  const wrap = document.querySelector('.timeline-wrap');
  if (!wrap) return;

  const rect = wrap.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  const w    = Math.round(rect.width)  || 600;
  const h    = Math.round(rect.height) || 160;

  document.getElementById('liveCanvas').width  = w * dpr;
  document.getElementById('liveCanvas').height = h * dpr;
  liveCanvasW = w;
  liveCanvasH = h;
}


// ─────────────────────────────────────────────────────────────
// LIVE PRESSURE CHART
// ─────────────────────────────────────────────────────────────

function drawLive() {
  if (!animRunning) return;
  requestAnimationFrame(drawLive);

  const dpr = window.devicePixelRatio || 1;
  const w   = liveCanvasW;
  const h   = liveCanvasH;
  if (w < 1 || h < 1) return;

  liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  liveCtx.clearRect(0, 0, w, h);

  const hist   = selectedBallId && balls[selectedBallId] ? balls[selectedBallId].history : [];
  const pad    = 6;
  const graphH = h - pad * 2;

  // Background grid lines
  liveCtx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
  liveCtx.lineWidth   = 1;
  for (let y = 0; y <= h; y += 40) {
    liveCtx.beginPath();
    liveCtx.moveTo(0, y);
    liveCtx.lineTo(w, y);
    liveCtx.stroke();
  }

  // Dashed threshold line at ADC 500
  liveCtx.setLineDash([4, 4]);
  liveCtx.strokeStyle = 'rgba(212, 134, 74, 0.4)';
  liveCtx.lineWidth   = 1;
  liveCtx.beginPath();
  const threshY = h - pad - (500 / 2000) * graphH;
  liveCtx.moveTo(0, threshY);
  liveCtx.lineTo(w, threshY);
  liveCtx.stroke();
  liveCtx.setLineDash([]);

  // Placeholder when there's no data yet
  if (hist.length < 2) {
    liveCtx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    liveCtx.font      = '13px Nunito, sans-serif';
    liveCtx.textAlign = 'center';
    liveCtx.fillText('Squeeze data will appear here...', w / 2, h / 2);
    return;
  }

  const px = i => (i / (MAX_HIST - 1)) * w;
  const py = v => h - pad - (Math.min(v, 2000) / 2000) * graphH;

  // Gradient fill under the line
  const grad = liveCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(26, 138, 110, 0.2)');
  grad.addColorStop(1, 'rgba(26, 138, 110, 0)');
  liveCtx.beginPath();
  liveCtx.moveTo(px(0), h);
  for (let i = 0; i < hist.length; i++) liveCtx.lineTo(px(i), py(hist[i]));
  liveCtx.lineTo(px(hist.length - 1), h);
  liveCtx.closePath();
  liveCtx.fillStyle = grad;
  liveCtx.fill();

  // The pressure line itself
  liveCtx.beginPath();
  for (let i = 0; i < hist.length; i++) {
    i === 0 ? liveCtx.moveTo(px(i), py(hist[i])) : liveCtx.lineTo(px(i), py(hist[i]));
  }
  liveCtx.strokeStyle = '#1A8A6E';
  liveCtx.lineWidth   = 2;
  liveCtx.lineJoin    = 'round';
  liveCtx.stroke();

  // Dot at the most recent reading, colored by intensity
  if (hist.length > 0) {
    const last  = hist[hist.length - 1];
    const dx    = px(hist.length - 1);
    const dy    = py(last);
    const pct   = Math.min(last / 2000, 1);
    const color = pct > 0.7 ? '#C9544A' : pct > 0.35 ? '#D4864A' : '#1A8A6E';
    const glow  = pct > 0.7 ? 'rgba(201,84,74,0.15)' : pct > 0.35 ? 'rgba(212,134,74,0.15)' : 'rgba(26,138,110,0.15)';

    liveCtx.beginPath();
    liveCtx.arc(dx, dy, 8, 0, Math.PI * 2);
    liveCtx.fillStyle = glow;
    liveCtx.fill();

    liveCtx.beginPath();
    liveCtx.arc(dx, dy, 3.5, 0, Math.PI * 2);
    liveCtx.fillStyle = color;
    liveCtx.fill();
  }
}


// ─────────────────────────────────────────────────────────────
// DAY VIEW BAR CHART
// ─────────────────────────────────────────────────────────────

function drawDayChart(id) {
  const canvas = document.getElementById('dayCanvas');
  if (!canvas) return;

  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  const w    = Math.round(rect.width) || 700;
  const h    = 260;

  canvas.width  = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!id || !balls[id]) return;

  const pd       = balls[id].periodData;
  const maxCount = Math.max(...pd.map(p => p.count), 1);
  const barPad   = 16;
  const barGap   = 8;
  const n        = pd.length;
  const barW     = (w - barPad * 2 - (n - 1) * barGap) / n;
  const chartH   = h - 60;

  pd.forEach((p, i) => {
    const x   = barPad + i * (barW + barGap);
    const bh  = p.count ? (p.count / maxCount) * chartH : 0;
    const y   = 10 + chartH - bh;
    const pct = p.count / maxCount;

    // Bar color based on intensity
    const grad = ctx.createLinearGradient(0, y, 0, y + bh);
    grad.addColorStop(0, pct > 0.7 ? '#C9544A' : pct > 0.35 ? '#D4864A' : '#1A8A6E');
    grad.addColorStop(1, pct > 0.7 ? 'rgba(201,84,74,0.3)' : pct > 0.35 ? 'rgba(212,134,74,0.3)' : 'rgba(26,138,110,0.3)');

    // Draw bar with rounded top corners
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + barW - 4, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + 4);
    ctx.lineTo(x + barW, y + bh);
    ctx.lineTo(x, y + bh);
    ctx.lineTo(x, y + 4);
    ctx.quadraticCurveTo(x, y, x + 4, y);
    ctx.closePath();
    ctx.fill();

    // Count label above bar
    if (p.count > 0) {
      ctx.fillStyle = '#2D2A26';
      ctx.font      = 'bold 12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.count, x + barW / 2, y - 6);
    }

    // Period name label below bar
    ctx.fillStyle = '#A39E98';
    ctx.font      = '10px Nunito, sans-serif';
    ctx.textAlign = 'center';
    const label   = p.name.length > 8 ? p.name.slice(0, 7) + '…' : p.name;
    ctx.fillText(label, x + barW / 2, h - 4);
  });
}


// ─────────────────────────────────────────────────────────────
// DATA INGESTION
// ─────────────────────────────────────────────────────────────

// Called every 100ms from the BLE live pressure notification
function addBallPressure(id, value) {
  if (!balls[id]) return;
  balls[id].history.push(value);
  if (balls[id].history.length > MAX_HIST) balls[id].history.shift();
}

// Called each time a completed squeeze event is received
function addBallSqueeze(id, peak, dur, ts) {
  if (!balls[id]) return;
  const b = balls[id];

  b.squeezes = (b.squeezes || 0) + 1;
  b.peak     = Math.max(b.peak || 0, peak);
  b.events.push({ peak, dur, ts });

  // Figure out which school period this squeeze happened in
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  b.periodData.forEach(p => {
    const [sh, sm] = p.start.split(':').map(Number);
    const [eh, em] = p.end.split(':').map(Number);
    if (mins >= sh * 60 + sm && mins < eh * 60 + em) {
      p.count++;
      p.totalPressure += peak;
    }
  });

  // Update the UI if this is the student we're currently watching
  if (id === selectedBallId) {
    updateLiveMetrics(id);
    addLogEntry(peak, dur, b.squeezes);
    updateDayView(id);
  }

  updateClassroomView();
}


// ─────────────────────────────────────────────────────────────
// UI UPDATE FUNCTIONS
// ─────────────────────────────────────────────────────────────

// Update the gauge and pressure readout in Live View
function updateLive(id, pressure, inSqueeze) {
  if (id !== selectedBallId) return;

  const pct = Math.min(pressure / 2000, 1);
  document.getElementById('gaugeVal').textContent  = pressure;
  document.getElementById('gaugePct').textContent  = Math.round(pct * 100) + '%';
  document.getElementById('gaugeArc').setAttribute('stroke-dashoffset', 389.6 * (1 - pct));
  document.getElementById('gaugeArc').setAttribute('stroke', pct > 0.7 ? '#C9544A' : pct > 0.35 ? '#D4864A' : '#1A8A6E');
  document.getElementById('metricPressure').textContent = pressure;
}

// Update the squeeze count and average intensity cards
function updateLiveMetrics(id) {
  if (!balls[id]) return;
  const b = balls[id];

  document.getElementById('metricSqueezes').textContent = b.squeezes;

  if (b.events && b.events.length > 0) {
    const avg = Math.round(b.events.reduce((s, e) => s + e.peak, 0) / b.events.length);
    document.getElementById('metricAvg').textContent = avg;
  }
}

// Add a new row to the squeeze event log
function addLogEntry(peak, dur, count) {
  const container = document.getElementById('logEntries');
  if (count === 1) container.innerHTML = '';  // clear placeholder on first event

  const pct = Math.min(peak / 2000 * 100, 100);
  let intensityClass, intensityLabel;
  if      (pct > 70) { intensityClass = 'intensity-high'; intensityLabel = 'High'; }
  else if (pct > 35) { intensityClass = 'intensity-med';  intensityLabel = 'Med';  }
  else               { intensityClass = 'intensity-low';  intensityLabel = 'Low';  }

  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `
    <span class="log-num">#${count}</span>
    <span class="intensity-label ${intensityClass}">${intensityLabel}</span>
    <div class="log-bar"><div class="log-bar-fill" style="width: ${pct}%"></div></div>
    <span class="log-meta">${peak} peak · ${dur}ms</span>
  `;
  container.prepend(el);

  // Keep the log from growing too long
  while (container.children.length > 50) container.removeChild(container.lastChild);
}

// Update the Day View tab for a specific student
function updateDayView(id) {
  if (!balls[id] || id !== selectedBallId) return;
  const b = balls[id];

  document.getElementById('dayTotal').textContent = b.squeezes;

  const peakPeriod = b.periodData.reduce((mx, p) => p.count > mx.count ? p : mx, { count: 0, name: '—' });
  document.getElementById('dayPeak').textContent    = peakPeriod.count || '—';
  document.getElementById('dayPeakSub').textContent = peakPeriod.count ? peakPeriod.name : 'No data yet';

  // Build the session summary sentence
  const topPeriods = b.periodData.filter(p => p.count > 0).sort((a, c) => c.count - a.count);
  if (topPeriods.length > 0) {
    const top    = topPeriods[0];
    const avg    = Math.round(b.events.reduce((s, e) => s + e.peak, 0) / b.events.length);
    const prefix = avg > 1400
      ? `<span class="summary-warn">Elevated intensity (avg ${avg})</span> during `
      : 'Most activity during ';

    document.getElementById('summaryText').innerHTML =
      `<span class="summary-highlight">${b.name}</span> has squeezed <strong>${b.squeezes}x</strong> this session. `
      + prefix
      + `<strong>${top.name}</strong> (${top.count} squeezes).`
      + (topPeriods.length > 1 ? ` Also active during ${topPeriods[1].name}.` : '');
  }

  drawDayChart(id);
}

// Refresh the Classroom tab summary cards and ball list
function updateClassroomView() {
  const ids = Object.keys(balls);

  document.getElementById('csConnected').textContent = ids.length;
  document.getElementById('csSqueezes').textContent  = ids.reduce((s, id) => s + (balls[id].squeezes || 0), 0);

  if (ids.length > 0) {
    const mostActiveId = ids.reduce((mx, id) => balls[id].squeezes > balls[mx].squeezes ? id : mx, ids[0]);
    document.getElementById('csMostActive').textContent    = balls[mostActiveId].name;
    document.getElementById('csMostActiveSub').textContent = balls[mostActiveId].squeezes + ' squeezes';

    const withEvents = ids.filter(id => balls[id].events && balls[id].events.length > 0);
    if (withEvents.length > 0) {
      const avg = withEvents.reduce((s, id) => {
        return s + balls[id].events.reduce((a, e) => a + e.peak, 0) / balls[id].events.length;
      }, 0) / withEvents.length;
      document.getElementById('csAvgIntensity').textContent = Math.round(avg);
    }
  }

  renderBallList();
}

// Re-render the list of ball rows in the Classroom tab
function renderBallList() {
  const list = document.getElementById('ballList');
  list.innerHTML = '';

  Object.values(balls).forEach(b => {
    const row = document.createElement('div');
    row.className = 'ball-row' + (b.id === selectedBallId ? ' selected' : '');
    row.onclick   = () => selectBall(b.id);

    const batteryStr = b.battery != null ? `🔋${b.battery}%` : 'Ball';
    const liveColor  = b.inSqueeze ? 'var(--coral)' : 'var(--border)';

    row.innerHTML = `
      <div class="ball-avatar" style="background: ${b.color}">${b.name[0]}</div>
      <div>
        <div class="ball-name">${b.name}</div>
        <div class="ball-sub">${batteryStr}</div>
      </div>
      <div class="ball-stats">
        <div class="ball-stat">
          <div class="val">${b.squeezes || 0}</div>
          <div class="lbl">Squeezes</div>
        </div>
        <div class="ball-stat">
          <div class="val">${b.peak || 0}</div>
          <div class="lbl">Peak</div>
        </div>
        <div class="ball-stat">
          <div class="val" style="width:14px; height:14px; border-radius:50%; background:${liveColor}; display:inline-block;"></div>
          <div class="lbl">Live</div>
        </div>
      </div>
      <div style="font-size: 12px; color: var(--text-dim)">View →</div>
    `;
    list.appendChild(row);
  });
}

// Switch which student is shown in Live View and Day View
function selectBall(id) {
  selectedBallId = id;
  const b = balls[id];

  document.getElementById('liveSelectedLabel').innerHTML = `Viewing: <strong>${b.name}</strong>`;
  document.getElementById('daySelectedLabel').innerHTML  = `Viewing: <strong>${b.name}</strong>`;

  updateLive(id, b.livePressure, b.inSqueeze);
  updateLiveMetrics(id);

  // Rebuild the event log for the newly selected student
  const container = document.getElementById('logEntries');
  container.innerHTML = '';
  if (b.events && b.events.length > 0) {
    b.events.slice().reverse().forEach((e, i) => addLogEntry(e.peak, e.dur, b.events.length - i));
  } else {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 20px 0; text-align: center;">Waiting for first squeeze...</div>';
  }

  updateDayView(id);
  renderBallList();
}

// Switch between Classroom / Live / Day tabs
function switchTab(tab) {
  const tabNames = ['classroom', 'live', 'day'];
  const panelIds = ['panelClassroom', 'panelLive', 'panelDay'];

  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', tabNames[i] === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel, i) => {
    panel.classList.toggle('active', panelIds[i] === 'panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
  });

  if (tab === 'live') sizeLive();
  if (tab === 'day' && selectedBallId) drawDayChart(selectedBallId);
}


// ─────────────────────────────────────────────────────────────
// SESSION TIMER
// ─────────────────────────────────────────────────────────────

function startTimer() {
  if (timerInterval) return;
  sessionStart  = Date.now();
  timerInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - sessionStart) / 1000);
    document.getElementById('metricTime').textContent =
      Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  }, 1000);
}

function showDashboard() {
  document.getElementById('connectScreen').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');
  document.getElementById('statusBadge').className = 'status-badge connected';
  startTimer();
  setTimeout(() => sizeLive(), 80);
}


// ─────────────────────────────────────────────────────────────
// DEMO MODE
// ─────────────────────────────────────────────────────────────

function startDemo() {
  isDemo = true;
  document.getElementById('demoBanner').style.display = 'flex';
  document.getElementById('statusText').textContent   = 'Demo Mode — 6 balls';
  showDashboard();

  // Each student has a different squeeze frequency and intensity
  const students = [
    { name: 'Emily', color: '#E8785E', freq: 2200, pk: 1400, variance: 300 },
    { name: 'Jake',  color: '#5BA4CF', freq: 4000, pk: 800,  variance: 200 },
    { name: 'Mia',   color: '#9B6BBF', freq: 1800, pk: 1600, variance: 400 },
    { name: 'Liam',  color: '#4BA87D', freq: 5000, pk: 600,  variance: 150 },
    { name: 'Ava',   color: '#D4864A', freq: 2500, pk: 1200, variance: 250 },
    { name: 'Noah',  color: '#3D8DBF', freq: 3500, pk: 900,  variance: 200 },
  ];

  students.forEach(s => {
    const id = genId();
    createBall(id, s.name, s.color, 0, 0, Math.floor(60 + Math.random() * 40));

    // Auto-select the first student for the Live View
    if (!selectedBallId) {
      selectedBallId = id;
      document.getElementById('liveSelectedLabel').innerHTML = `Viewing: <strong>${s.name}</strong>`;
      document.getElementById('daySelectedLabel').innerHTML  = `Viewing: <strong>${s.name}</strong>`;
    }

    // Simulate a continuous pressure reading at 10 Hz
    let phase = Math.random() * Math.PI * 2;
    setInterval(() => {
      phase += 0.15;
      const value = Math.max(0, Math.round(80 + Math.sin(phase) * 60 + (Math.random() - 0.5) * 40));
      balls[id].livePressure = value;
      addBallPressure(id, value);
      if (id === selectedBallId) updateLive(id, value, balls[id].inSqueeze);
    }, 100);

    // Simulate squeeze events at random intervals based on each student's frequency
    function scheduleNextSqueeze() {
      if (!balls[id]) return;
      const peak = Math.max(200, Math.min(2000, Math.round(s.pk + (Math.random() - 0.5) * s.variance * 2)));
      const dur  = Math.round(400 + Math.random() * 800);
      balls[id].inSqueeze = true;
      addBallSqueeze(id, peak, dur, Date.now());
      setTimeout(() => { if (balls[id]) balls[id].inSqueeze = false; }, dur);
      setTimeout(scheduleNextSqueeze, s.freq + (Math.random() - 0.5) * s.freq * 0.6);
    }
    setTimeout(scheduleNextSqueeze, Math.random() * 3000 + 500);
  });

  updateClassroomView();
  if (!animRunning) { animRunning = true; requestAnimationFrame(drawLive); }
}


// ─────────────────────────────────────────────────────────────
// BLE CONNECTION
// ─────────────────────────────────────────────────────────────

async function connectBLE() {
  const btn = document.getElementById('btnConnect');
  btn.disabled    = true;
  btn.textContent = 'Scanning...';

  try {
    // Ask the browser to show the Bluetooth device picker
    const device = await navigator.bluetooth.requestDevice({
      filters:          [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });

    btn.textContent = 'Connecting...';
    const server  = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const id      = genId();

    createBall(id, device.name || 'Ball_' + id.slice(0, 4), `hsl(${Math.random() * 360}, 55%, 55%)`, 0, 0, null);

    if (!selectedBallId) {
      selectedBallId = id;
      document.getElementById('liveSelectedLabel').innerHTML = `Viewing: <strong>${balls[id].name}</strong>`;
      document.getElementById('daySelectedLabel').innerHTML  = `Viewing: <strong>${balls[id].name}</strong>`;
    }

    // Subscribe to the live pressure stream (fires every 100ms)
    const liveChar = await service.getCharacteristic(CHAR_LIVE_UUID);
    await liveChar.startNotifications();
    liveChar.addEventListener('characteristicvaluechanged', e => {
      const parts = new TextDecoder().decode(e.target.value).split(',').map(Number);
      balls[id].livePressure = parts[0];
      balls[id].inSqueeze    = parts[1] === 1;
      addBallPressure(id, parts[0]);
      updateLive(id, parts[0], parts[1] === 1);
    });

    // Subscribe to squeeze events (fires once per completed squeeze)
    const sqChar = await service.getCharacteristic(CHAR_SQUEEZE_UUID);
    await sqChar.startNotifications();
    sqChar.addEventListener('characteristicvaluechanged', e => {
      const parts = new TextDecoder().decode(e.target.value).split(',').map(Number);
      addBallSqueeze(id, parts[0], parts[1], parts[3]);
    });

    // Read the battery level from the status characteristic (optional)
    try {
      const statChar = await service.getCharacteristic(CHAR_STATUS_UUID);
      const value    = await statChar.readValue();
      const match    = new TextDecoder().decode(value).match(/bat:(\d+)/);
      if (match) balls[id].battery = parseInt(match[1]);
    } catch (e) { /* battery read is optional — ignore if unsupported */ }

    // Clean up if the ball disconnects unexpectedly
    device.addEventListener('gattserverdisconnected', () => {
      delete balls[id];
      if (selectedBallId === id) selectedBallId = Object.keys(balls)[0] || null;
      updateClassroomView();
    });

    showDashboard();
    document.getElementById('statusText').textContent = Object.keys(balls).length + ' ball(s) connected';
    updateClassroomView();
    btn.disabled    = false;
    btn.textContent = 'Connect Another Ball';
    if (!animRunning) { animRunning = true; requestAnimationFrame(drawLive); }

  } catch (err) {
    console.error(err);
    btn.disabled    = false;
    btn.textContent = 'Connect via Bluetooth';
    if (err.name !== 'NotFoundError') alert('Connection failed: ' + err.message);
  }
}

function disconnectAll() {
  if (timerInterval) clearInterval(timerInterval);

  animRunning    = false;
  balls          = {};
  selectedBallId = null;
  isDemo         = false;
  sessionStart   = null;
  timerInterval  = null;

  document.getElementById('dashboard').classList.remove('active');
  document.getElementById('connectScreen').style.display = '';
  document.getElementById('demoBanner').style.display    = 'none';
  document.getElementById('statusBadge').className       = 'status-badge disconnected';
  document.getElementById('statusText').textContent      = 'Disconnected';
  switchTab('classroom');
}


// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
window.addEventListener('resize', sizeLive);
setTimeout(initCanvases, 100);