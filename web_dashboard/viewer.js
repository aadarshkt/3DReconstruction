/**
 * FloorPlan Pipeline — Web Dashboard JavaScript
 *
 * Responsibilities:
 * - Tab switching (Floor Plan SVG ↔ 3D Point Cloud)
 * - REST calls to the backend (load results, build download links)
 * - Three.js PLY point cloud viewer
 * - SVG floor plan inline rendering with wall hover tooltips
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const serverInput   = document.getElementById('serverUrl');
const jobIdInput    = document.getElementById('jobIdInput');
const loadBtn       = document.getElementById('loadBtn');
const summaryCard   = document.getElementById('summaryCard');
const downloadsCard = document.getElementById('downloadsCard');
const wallsCard     = document.getElementById('wallsCard');
const downloadList  = document.getElementById('downloadList');
const wallTableBody = document.getElementById('wallTableBody');
const svgContainer  = document.getElementById('svgContainer');
const threeContainer = document.getElementById('threeContainer');
const statusBar     = document.getElementById('statusBar');
const statusText    = document.getElementById('statusText');
const spinner       = document.getElementById('spinner');

// ── Auto-configure server & query params ─────────────────────────────────────
if (window.location.protocol.startsWith('http') && window.location.origin && window.location.origin !== 'null') {
  serverInput.value = window.location.origin;
}

// ── Three.js state ────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, animFrameId;

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.remove('active');
      c.classList.add('hidden');
    });
    tab.classList.add('active');
    const target = document.getElementById('tab' + capitalize(tab.dataset.tab));
    if (target) {
      target.classList.add('active');
      target.classList.remove('hidden');
    }

    // Init or refresh Three.js when the 3D tab is shown
    if (tab.dataset.tab === 'pointcloud') {
      if (!renderer) {
        initThreeJS();
      } else if (window._pendingPLY) {
        const { base, jobId, path } = window._pendingPLY;
        loadPLY(base, jobId, path);
        window._pendingPLY = null;
      }
      setTimeout(onResize, 50);
    }
  });
});

// ── Load results ──────────────────────────────────────────────────────────────
loadBtn.addEventListener('click', loadResults);
jobIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadResults(); });

// Check URL query parameters for auto-loading (?job_id=...)
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const qJobId = params.get('job_id') || params.get('jobId');
  if (qJobId) {
    jobIdInput.value = qJobId;
    loadResults();
  }
});

async function loadResults() {
  const jobId = jobIdInput.value.trim();
  if (!jobId) { alert('Please enter a Job ID.'); return; }

  const base = serverInput.value.replace(/\/$/, '');
  showStatus('Loading results…', true);

  try {
    // Fetch result JSON
    const res = await fetch(`${base}/jobs/${jobId}/results`);
    if (!res.ok) {
      const errText = await res.text();
      let msg = errText;
      try {
        const parsed = JSON.parse(errText);
        msg = parsed.detail || errText;
      } catch (_) {}
      try {
        const infoRes = await fetch(`${base}/jobs/${jobId}`);
        if (infoRes.ok) {
          const info = await infoRes.json();
          if (info.error_message) msg = info.error_message;
        }
      } catch (_) {}
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();

    renderSummary(data);
    renderWallTable(data.walls || []);
    renderDownloads(base, jobId, data.files || {});
    await renderSVG(base, jobId, data.files?.floor_plan_svg);

    // Pre-load PLY into Three.js if already visible
    if (document.getElementById('tabPointcloud').classList.contains('active')) {
      loadPLY(base, jobId, data.files?.point_cloud_ply);
    } else {
      // Store for deferred load
      window._pendingPLY = { base, jobId, path: data.files?.point_cloud_ply };
    }

    showStatus('Results loaded ✓', false);
    setTimeout(hideStatus, 2000);

  } catch (err) {
    showStatus(`Error: ${err.message}`, false);
    console.error(err);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
function renderSummary(data) {
  document.getElementById('statArea').textContent =
    (data.room_area_m2 !== undefined && data.room_area_m2 !== null)
      ? `${Number(data.room_area_m2).toFixed(1)} m²` : '—';
  document.getElementById('statWalls').textContent = data.wall_count ?? '—';
  document.getElementById('statError').textContent =
    data.error_estimate ? `≈ ${data.error_estimate.expected_wall_error_cm} cm` : '—';
  document.getElementById('statTier').textContent =
    data.scale_confidence === 'native_metric' ? 'LiDAR' : 'Scaled';

  summaryCard.classList.remove('hidden');
}

// ── Wall table ────────────────────────────────────────────────────────────────
function renderWallTable(walls) {
  wallTableBody.innerHTML = '';
  if (!walls || walls.length === 0) {
    wallsCard.classList.add('hidden');
    return;
  }
  walls.forEach(w => {
    const tr = document.createElement('tr');
    const openingTag = w.has_opening && w.opening_type
      ? `<span class="tag tag-${w.opening_type}">${w.opening_type}</span>` : '—';
    tr.innerHTML = `<td>${w.id}</td><td>${w.length_m.toFixed(2)}</td><td>${openingTag}</td>`;
    wallTableBody.appendChild(tr);
  });
  wallsCard.classList.remove('hidden');
}

// ── Downloads ─────────────────────────────────────────────────────────────────
function renderDownloads(base, jobId, files) {
  downloadList.innerHTML = '';
  const items = [
    { key: 'floor_plan_svg', label: 'Floor Plan SVG', icon: '🗺️' },
    { key: 'floor_plan_dxf', label: 'Floor Plan DXF (CAD)', icon: '📐' },
    { key: 'point_cloud_ply', label: 'Point Cloud PLY', icon: '☁️' },
    { key: 'validation_csv', label: 'Validation CSV', icon: '📊' },
  ];
  items.forEach(({ key, label, icon }) => {
    const path = files[key];
    if (!path) return;
    const filename = path.split('/').pop();
    const a = document.createElement('a');
    a.className = 'btn btn-download';
    a.href = `${base}/jobs/${jobId}/files/${filename}`;
    a.target = '_blank';
    if (key !== 'floor_plan_svg') {
      a.download = filename;
    }
    a.innerHTML = `<span class="icon">${icon}</span><span>${label}</span>`;
    downloadList.appendChild(a);
  });
  downloadsCard.classList.remove('hidden');
}

// ── SVG floor plan ────────────────────────────────────────────────────────────
async function renderSVG(base, jobId, svgPath) {
  if (!svgPath) return;
  const filename = svgPath.split('/').pop();
  const svgURL   = `${base}/jobs/${jobId}/files/${filename}`;

  try {
    const res  = await fetch(svgURL);
    if (!res.ok) {
      console.warn(`SVG fetch failed with status ${res.status}`);
      svgContainer.innerHTML = `
        <div class="placeholder-message">
          <p>SVG floor plan preview unavailable (HTTP ${res.status})</p>
        </div>`;
      return;
    }
    const text = await res.text();
    svgContainer.innerHTML = text;

    // Inject wall hover tooltips
    const svgEl = svgContainer.querySelector('svg');
    if (svgEl) {
      svgEl.style.cursor = 'default';
      svgEl.addEventListener('mousemove', handleSVGHover);
    }
  } catch (e) {
    console.warn('SVG load failed:', e);
    svgContainer.innerHTML = `
      <div class="placeholder-message">
        <p>Could not load SVG preview: ${e.message}</p>
      </div>`;
  }
}

function handleSVGHover(e) {
  // Simple: show tooltip near cursor when hovering a <line> element
  const target = e.target;
  if (target.tagName === 'line' || target.tagName === 'text') {
    target.style.opacity = '0.7';
  } else {
    e.currentTarget.querySelectorAll('line, text').forEach(el => el.style.opacity = '1');
  }
}

// ── Three.js init ─────────────────────────────────────────────────────────────
function initThreeJS() {
  // Clean container
  threeContainer.querySelector('.placeholder-message')?.remove();

  scene    = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1117);

  camera   = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(0, 2, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  threeContainer.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Axis helper
  scene.add(new THREE.AxesHelper(0.5));

  // Grid
  const grid = new THREE.GridHelper(10, 20, 0x2e3347, 0x1a1d27);
  scene.add(grid);

  // Resize observer
  const ro = new ResizeObserver(onResize);
  ro.observe(threeContainer);
  onResize();

  // Animation loop
  function animate() {
    animFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Load PLY if pending
  if (window._pendingPLY) {
    const { base, jobId, path } = window._pendingPLY;
    loadPLY(base, jobId, path);
    window._pendingPLY = null;
  }
}

function onResize() {
  if (!renderer) return;
  const w = threeContainer.clientWidth;
  const h = threeContainer.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── PLY loader ────────────────────────────────────────────────────────────────
function loadPLY(base, jobId, plyPath) {
  if (!plyPath || !renderer) return;
  const filename = plyPath.split('/').pop();
  const url      = `${base}/jobs/${jobId}/files/${filename}`;

  showStatus('Loading point cloud…', true);

  const loader = new PLYLoader();
  loader.load(
    url,
    (geometry) => {
      // Remove previous cloud
      scene.getObjectsByProperty('name', 'pointCloud').forEach(o => scene.remove(o));

      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);

      // Check if geometry has vertex colors
      const hasColors = geometry.hasAttribute('color');
      const material = new THREE.PointsMaterial({
        size:         0.015,
        vertexColors: hasColors,
        color:        hasColors ? undefined : new THREE.Color(0x6366f1),
        sizeAttenuation: true,
      });

      const cloud = new THREE.Points(geometry, material);
      cloud.name = 'pointCloud';
      scene.add(cloud);

      // Fit camera to bounding box
      const box  = new THREE.Box3().setFromObject(cloud);
      const size = box.getSize(new THREE.Vector3()).length();
      camera.position.set(0, size * 0.5, size * 1.2);
      controls.target.set(0, 0, 0);
      controls.update();

      showStatus(`Point cloud loaded (${geometry.attributes.position.count.toLocaleString()} points)`, false);
      setTimeout(hideStatus, 3000);
    },
    (xhr) => {
      const pct = Math.round(xhr.loaded / xhr.total * 100);
      showStatus(`Loading point cloud… ${pct}%`, true);
    },
    (err) => {
      console.error('PLY load error:', err);
      showStatus('Failed to load point cloud', false);
    }
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────
function showStatus(msg, loading) {
  statusText.textContent = msg;
  spinner.classList.toggle('hidden', !loading);
  statusBar.classList.remove('hidden');
}

function hideStatus() {
  statusBar.classList.add('hidden');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Insurance claim flow ─────────────────────────────────────────────────────
const claimName       = document.getElementById('claimName');
const claimPolicy     = document.getElementById('claimPolicy');
const claimAddress    = document.getElementById('claimAddress');
const claimIncident   = document.getElementById('claimIncident');
const claimDesc       = document.getElementById('claimDesc');
const claimScale      = document.getElementById('claimScale');
const claimFiles      = document.getElementById('claimFiles');
const fileClaimBtn    = document.getElementById('fileClaimBtn');

const claimStatusCard     = document.getElementById('claimStatusCard');
const claimIdEl           = document.getElementById('claimId');
const claimStatusEl       = document.getElementById('claimStatus');
const claimProgressEl     = document.getElementById('claimProgress');
const claimImagesEl       = document.getElementById('claimImages');
const viewClaimReportBtn  = document.getElementById('viewClaimReportBtn');
const viewClaimObservabilityBtn = document.getElementById('viewClaimObservabilityBtn');

const reportModal    = document.getElementById('reportModal');
const reportBackdrop = document.getElementById('reportBackdrop');
const reportContent  = document.getElementById('reportContent');
const closeReportBtn = document.getElementById('closeReportBtn');

fileClaimBtn.addEventListener('click', fileClaim);
viewClaimReportBtn.addEventListener('click', () => {
  const claimId = claimIdEl.textContent;
  if (claimId && claimId !== '—') viewClaimReport(claimId);
});
viewClaimObservabilityBtn.addEventListener('click', () => {
  const claimId = claimIdEl.textContent;
  if (claimId && claimId !== '—') viewClaimObservability(claimId);
});
closeReportBtn.addEventListener('click', closeReportModal);
reportBackdrop.addEventListener('click', closeReportModal);

async function fileClaim() {
  const base = serverInput.value.replace(/\/$/, '');

  const name     = claimName.value.trim();
  const policy   = claimPolicy.value.trim();
  const address  = claimAddress.value.trim();
  const incident = claimIncident.value.trim();

  if (!name || !policy || !address || !incident) {
    alert('Please fill in policyholder, policy number, address, and incident type.');
    return;
  }
  if (claimFiles.files.length === 0) {
    alert('Please select at least one capture file.');
    return;
  }

  showStatus('Filing claim…', true);
  fileClaimBtn.disabled = true;

  try {
    // 1. Create claim
    const createBody = {
      policyholder_name: name,
      policy_number: policy,
      property_address: address,
      incident_type: incident,
      incident_description: claimDesc.value.trim() || null,
    };
    const scale = parseFloat(claimScale.value);
    if (!Number.isNaN(scale) && scale > 0) createBody.scale_reference_m = scale;

    const createRes = await fetch(`${base}/claims/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });
    if (!createRes.ok) throw new Error(await _errText(createRes));
    const claim = await createRes.json();
    const claimId = claim.claim_id;

    claimIdEl.textContent = claimId;
    claimStatusEl.textContent = claim.status;
    claimProgressEl.textContent = `${claim.progress_pct}%`;
    claimImagesEl.textContent = claimFiles.files.length;
    claimStatusCard.classList.remove('hidden');

    // 2. Upload capture files
    const form = new FormData();
    for (const f of claimFiles.files) form.append('files', f);

    const uploadRes = await fetch(`${base}/claims/${claimId}/upload`, {
      method: 'POST',
      body: form,
    });
    if (!uploadRes.ok) throw new Error(await _errText(uploadRes));

    // 3. Start the claim agent
    const startRes = await fetch(`${base}/claims/${claimId}/start`, { method: 'POST' });
    if (!startRes.ok) throw new Error(await _errText(startRes));

    showStatus('Claim submitted — processing…', true);
    pollClaim(claimId, base);

  } catch (err) {
    showStatus(`Claim error: ${err.message}`, false);
    console.error(err);
    fileClaimBtn.disabled = false;
  }
}

function pollClaim(claimId, base) {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`${base}/claims/${claimId}`);
      if (!res.ok) throw new Error(await _errText(res));
      const claim = await res.json();

      claimStatusEl.textContent = claim.status;
      claimProgressEl.textContent = `${claim.progress_pct}%`;
      claimImagesEl.textContent = claim.image_count ?? '—';

      if (claim.status === 'ready_for_review') {
        clearInterval(timer);
        fileClaimBtn.disabled = false;
        showStatus('Claim ready for review ✓', false);
        setTimeout(hideStatus, 3000);
        viewClaimReport(claimId);
      } else if (claim.status === 'failed') {
        clearInterval(timer);
        fileClaimBtn.disabled = false;
        showStatus(`Claim failed: ${claim.error_message || 'unknown error'}`, false);
      }
    } catch (err) {
      clearInterval(timer);
      fileClaimBtn.disabled = false;
      showStatus(`Polling error: ${err.message}`, false);
    }
  }, 3000);
}

async function viewClaimReport(claimId) {
  const base = serverInput.value.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/claims/${claimId}/report`);
    if (!res.ok) throw new Error(await _errText(res));
    const data = await res.json();
    reportContent.textContent = data.report_markdown || 'No report content.';
    reportModal.classList.remove('hidden');
  } catch (err) {
    showStatus(`Report error: ${err.message}`, false);
    console.error(err);
  }
}

async function viewClaimObservability(claimId) {
  const base = serverInput.value.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/claims/${claimId}/observability`);
    if (!res.ok) throw new Error(await _errText(res));
    const data = await res.json();
    reportContent.textContent = data.observability_markdown || 'No observability content.';
    reportModal.classList.remove('hidden');
  } catch (err) {
    showStatus(`Observability error: ${err.message}`, false);
    console.error(err);
  }
}

function closeReportModal() {
  reportModal.classList.add('hidden');
}

async function _errText(res) {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.detail || text;
  } catch (_) {
    return text;
  }
}
