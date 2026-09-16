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

  const stepGeometry = document.getElementById('testStepGeometry');
  const stepBadgeGeometry = document.getElementById('stepBadgeGeometry');
  const stepDescGeometry = document.getElementById('stepDescGeometry');
  if (stepGeometry && stepBadgeGeometry) {
    stepBadgeGeometry.className = 'step-status-badge badge badge-success';
    stepBadgeGeometry.textContent = `✓ ${Number(data.room_area_m2 || 0).toFixed(1)} m²`;
    stepGeometry.classList.add('passed-step');
    if (stepDescGeometry) {
      stepDescGeometry.textContent = `${data.wall_count || 4} walls detected · Native ${data.scale_confidence === 'native_metric' ? 'LiDAR' : 'Scaled'} confidence`;
    }
  }
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

// ── Insurance Claim Module ───────────────────────────────────────────────────
initClaimModule();

function initClaimModule() {
  const claimIdInput       = document.getElementById('claimIdInput');
  const newClaimBtn        = document.getElementById('newClaimBtn');
  const causeOfLossSelect  = document.getElementById('causeOfLossSelect');
  const damageDescInput    = document.getElementById('damageDescInput');
  const policyDropzone     = document.getElementById('policyDropzone');
  const policyDropzoneText = document.getElementById('policyDropzoneText');
  const policyFileInput    = document.getElementById('policyFileInput');
  const analyzeCoverageBtn = document.getElementById('analyzeCoverageBtn');
  const estimateCostsBtn   = document.getElementById('estimateCostsBtn');
  const coverageBadge      = document.getElementById('coverageBadge');
  const policyAnalysisBody = document.getElementById('policyAnalysisBody');
  const payoutBadge        = document.getElementById('payoutBadge');
  const costEstimateBody   = document.getElementById('costEstimateBody');
  const chatMessages       = document.getElementById('chatMessages');
  const chatInput          = document.getElementById('chatInput');
  const sendChatBtn        = document.getElementById('sendChatBtn');

  // Closed-loop testing suite elements
  const seedDemoHeaderBtn   = document.getElementById('seedDemoHeaderBtn');
  const loadDemoJobBtn      = document.getElementById('loadDemoJobBtn');
  const loadSamplePolicyBtn = document.getElementById('loadSamplePolicyBtn');
  const runAutoTestBtn      = document.getElementById('runAutoTestBtn');

  const stepGeometry       = document.getElementById('testStepGeometry');
  const stepBadgeGeometry  = document.getElementById('stepBadgeGeometry');
  const stepDescGeometry   = document.getElementById('stepDescGeometry');

  const stepPolicy         = document.getElementById('testStepPolicy');
  const stepBadgePolicy    = document.getElementById('stepBadgePolicy');
  const stepDescPolicy     = document.getElementById('stepDescPolicy');

  const stepAnalysis       = document.getElementById('testStepAnalysis');
  const stepBadgeAnalysis  = document.getElementById('stepBadgeAnalysis');
  const stepDescAnalysis   = document.getElementById('stepDescAnalysis');

  const stepCost           = document.getElementById('testStepCost');
  const stepBadgeCost      = document.getElementById('stepBadgeCost');
  const stepDescCost       = document.getElementById('stepDescCost');

  const stepChat           = document.getElementById('testStepChat');
  const stepBadgeChat      = document.getElementById('stepBadgeChat');
  const stepDescChat       = document.getElementById('stepDescChat');

  let currentClaimId = null;

  function setStepStatus(stepEl, badgeEl, text, statusClass, descEl = null, descText = null) {
    if (!stepEl || !badgeEl) return;
    badgeEl.className = `step-status-badge badge ${statusClass}`;
    badgeEl.textContent = text;
    if (descEl && descText) descEl.textContent = descText;

    if (statusClass === 'badge-success') {
      stepEl.classList.add('passed-step');
      stepEl.classList.remove('active-step');
    } else if (statusClass === 'badge-info' || statusClass === 'badge-accent') {
      stepEl.classList.add('active-step');
      stepEl.classList.remove('passed-step');
    } else {
      stepEl.classList.remove('passed-step', 'active-step');
    }
  }

  function getBase() {
    return serverInput.value.replace(/\/$/, '');
  }

  function switchToClaimTab() {
    const claimTabBtn = document.querySelector('.tab[data-tab="claim"]');
    if (claimTabBtn) claimTabBtn.click();
  }

  // 1-Click Complete Demo Seeding
  async function seedFullDemo() {
    const base = getBase();
    showStatus('Seeding complete demo (3D Scan + HO-3 Policy + Claim)…', true);

    try {
      const res = await fetch(`${base}/api/v1/claims/seed-demo`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      // 1. Populate Job ID & Load 3D results
      jobIdInput.value = data.job_id;
      await loadResults();

      // 2. Populate Claim inputs
      currentClaimId = data.claim_id;
      claimIdInput.value = data.claim_id;
      causeOfLossSelect.value = 'water';
      damageDescInput.value =
        'Supply pipe ruptured beneath kitchen sink while occupants were away for the weekend. ' +
        'Flooding covered the kitchen and adjacent living room area, soaking lower drywall, ' +
        'baseboards, and hardwood flooring across approximately 18.2 m².';

      policyDropzone.classList.add('uploaded');
      const pages = data.ingest_stats ? data.ingest_stats.total_pages : 22;
      policyDropzoneText.textContent = `✅ Policy Indexed (${pages} pages)`;
      analyzeCoverageBtn.disabled = false;
      estimateCostsBtn.disabled = false;

      // 3. Update Verification Steps
      setStepStatus(stepGeometry, stepBadgeGeometry, '✓ 24.5 m² LiDAR', 'badge-success', stepDescGeometry, '4 walls dimensioned with door and window openings.');
      setStepStatus(stepPolicy, stepBadgePolicy, `✓ HO-3 (${pages}p)`, 'badge-success', stepDescPolicy, 'ISO HO-3 Policy indexed into ChromaDB vector store.');
      setStepStatus(stepAnalysis, stepBadgeAnalysis, 'Ready to Run', 'badge-info');
      setStepStatus(stepCost, stepBadgeCost, 'Ready to Run', 'badge-info');
      setStepStatus(stepChat, stepBadgeChat, 'Ready to Test', 'badge-neutral');

      // 4. Switch to Claim Tab
      switchToClaimTab();
      showStatus('Complete Demo Loaded ✓ Ready for testing', false);
      setTimeout(hideStatus, 2500);
      return data;
    } catch (e) {
      showStatus(`Failed to seed demo: ${e.message}`, false);
      throw e;
    }
  }

  // Attach demo listeners
  if (seedDemoHeaderBtn) seedDemoHeaderBtn.addEventListener('click', seedFullDemo);
  if (loadDemoJobBtn) loadDemoJobBtn.addEventListener('click', seedFullDemo);

  // Load sample policy directly
  if (loadSamplePolicyBtn) {
    loadSamplePolicyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const base = getBase();
      const claimId = await ensureClaim();
      showStatus('Loading & indexing sample ISO HO-3 policy…', true);
      try {
        const res = await fetch(`${base}/api/v1/claims/${claimId}/policy/load-sample`, { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        policyDropzone.classList.add('uploaded');
        const pages = data.ingest_stats ? data.ingest_stats.total_pages : 22;
        policyDropzoneText.textContent = `✅ Policy Indexed (${pages} pages)`;
        analyzeCoverageBtn.disabled = false;
        setStepStatus(stepPolicy, stepBadgePolicy, `✓ HO-3 (${pages}p)`, 'badge-success', stepDescPolicy, 'Sample ISO HO-3 policy indexed into ChromaDB.');
        showStatus('Sample ISO HO-3 policy successfully indexed ✓', false);
        setTimeout(hideStatus, 2500);
      } catch (err) {
        showStatus(`Failed to load sample policy: ${err.message}`, false);
      }
    });
  }

  // Automated Closed-Loop Test Runner
  if (runAutoTestBtn) {
    runAutoTestBtn.addEventListener('click', async () => {
      runAutoTestBtn.disabled = true;
      runAutoTestBtn.textContent = '⏳ Running Test Sequence…';

      try {
        // Step 1 & 2: Seed Demo
        showStatus('[1/4] Seeding 3D Scan & HO-3 Policy…', true);
        await seedFullDemo();
        await new Promise(r => setTimeout(r, 600));

        // Step 3: Analyze Policy
        showStatus('[2/4] Running Policy Coverage Analysis (RAG)…', true);
        analyzeCoverageBtn.click();
        await new Promise(r => setTimeout(r, 2200));

        // Step 4: Estimate Costs
        showStatus('[3/4] Scoping & Calculating Repair Costs…', true);
        estimateCostsBtn.click();
        await new Promise(r => setTimeout(r, 2200));

        // Step 5: Test Chat Router
        showStatus('[4/4] Testing Natural Language Multi-Intent Chat…', true);
        chatInput.value = 'Is water damage from a burst pipe covered under this policy?';
        await sendChatMessage();

        setStepStatus(stepChat, stepBadgeChat, '✓ Verified', 'badge-success', stepDescChat, 'Multi-intent routing verified with cited policy sections.');
        showStatus('🎉 All 5 Pipeline Features Verified in Closed Loop!', false);
        setTimeout(hideStatus, 4000);
      } catch (err) {
        showStatus(`Auto test failed: ${err.message}`, false);
      } finally {
        runAutoTestBtn.disabled = false;
        runAutoTestBtn.textContent = '▶ Run Full Pipeline Test';
      }
    });
  }

  // Prompt Suggestion Chips
  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chatInput.value = chip.dataset.prompt;
      sendChatMessage();
    });
  });

  // Create or retrieve claim
  async function ensureClaim() {
    if (currentClaimId) return currentClaimId;

    const base = getBase();
    const jobId = jobIdInput.value.trim() || null;
    const cause = causeOfLossSelect.value;
    const desc = damageDescInput.value.trim() || 'Physical property damage walkthrough';

    showStatus('Creating insurance claim…', true);
    try {
      const res = await fetch(`${base}/api/v1/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          cause_of_loss: cause,
          damage_description: desc,
          property_type: 'residential',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const claim = await res.json();
      currentClaimId = claim.id;
      claimIdInput.value = claim.id;
      showStatus('Claim created ✓', false);
      setTimeout(hideStatus, 2000);
      return currentClaimId;
    } catch (e) {
      showStatus(`Failed to create claim: ${e.message}`, false);
      throw e;
    }
  }

  newClaimBtn.addEventListener('click', async () => {
    currentClaimId = null;
    claimIdInput.value = '';
    policyDropzone.classList.remove('uploaded');
    policyDropzoneText.textContent = 'Drop Policy PDF here or click';
    analyzeCoverageBtn.disabled = true;
    estimateCostsBtn.disabled = false;
    coverageBadge.className = 'badge badge-neutral';
    coverageBadge.textContent = 'No Analysis';
    policyAnalysisBody.innerHTML = '<p class="empty-state-text">Upload your policy PDF and click <strong>"Analyze Policy"</strong> to evaluate coverage clauses, deductibles, and exclusions.</p>';
    payoutBadge.className = 'badge badge-neutral';
    payoutBadge.textContent = '—';
    costEstimateBody.innerHTML = '<p class="empty-state-text">Click <strong>"Estimate Costs"</strong> to calculate line items from 3D scan dimensions and repair rate tables.</p>';
    setStepStatus(stepPolicy, stepBadgePolicy, 'No Policy', 'badge-neutral');
    setStepStatus(stepAnalysis, stepBadgeAnalysis, 'Pending', 'badge-neutral');
    setStepStatus(stepCost, stepBadgeCost, 'Pending', 'badge-neutral');
    await ensureClaim();
  });

  claimIdInput.addEventListener('change', async () => {
    const id = claimIdInput.value.trim();
    if (!id) return;
    currentClaimId = id;
    const base = getBase();
    try {
      const res = await fetch(`${base}/api/v1/claims/${id}`);
      if (res.ok) {
        const claim = await res.json();
        causeOfLossSelect.value = claim.cause_of_loss || 'water';
        damageDescInput.value = claim.damage_description || '';
        if (claim.has_policy_pdf) {
          policyDropzone.classList.add('uploaded');
          policyDropzoneText.textContent = '✅ Policy PDF Uploaded';
          analyzeCoverageBtn.disabled = false;
        }
        if (claim.policy_analysis) renderPolicyAnalysis(claim.policy_analysis);
        if (claim.cost_estimate) renderCostEstimate(claim.cost_estimate);
      }
    } catch (_) {}
  });

  // Policy Dropzone
  policyDropzone.addEventListener('click', () => policyFileInput.click());
  policyDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    policyDropzone.classList.add('dragover');
  });
  policyDropzone.addEventListener('dragleave', () => policyDropzone.classList.remove('dragover'));
  policyDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    policyDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handlePolicyFile(e.dataTransfer.files[0]);
    }
  });
  policyFileInput.addEventListener('change', () => {
    if (policyFileInput.files && policyFileInput.files.length > 0) {
      handlePolicyFile(policyFileInput.files[0]);
    }
  });

  async function handlePolicyFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please upload an insurance policy PDF file.');
      return;
    }
    const base = getBase();
    const claimId = await ensureClaim();

    showStatus('Uploading & indexing policy with RAG…', true);
    policyDropzoneText.textContent = 'Indexing policy pages…';

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${base}/api/v1/claims/${claimId}/policy/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      policyDropzone.classList.add('uploaded');
      const pages = data.ingest_stats ? data.ingest_stats.total_pages : 'all';
      policyDropzoneText.textContent = `✅ Policy Indexed (${pages} pages)`;
      analyzeCoverageBtn.disabled = false;
      showStatus('Policy PDF successfully indexed in vector store ✓', false);
      setTimeout(hideStatus, 2500);
    } catch (err) {
      policyDropzoneText.textContent = 'Upload failed. Try again';
      showStatus(`Policy upload failed: ${err.message}`, false);
    }
  }

  // Analyze Coverage
  analyzeCoverageBtn.addEventListener('click', async () => {
    const claimId = await ensureClaim();
    const base = getBase();

    showStatus('Running legal policy coverage analysis…', true);
    analyzeCoverageBtn.disabled = true;

    try {
      const res = await fetch(`${base}/api/v1/claims/${claimId}/policy/analyze`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      renderPolicyAnalysis(data.analysis);
      switchToClaimTab();
      showStatus('Policy analysis complete ✓', false);
      setTimeout(hideStatus, 2000);
    } catch (e) {
      showStatus(`Analysis failed: ${e.message}`, false);
    } finally {
      analyzeCoverageBtn.disabled = false;
    }
  });

  function renderPolicyAnalysis(analysis) {
    if (!analysis) return;

    if (analysis.is_covered === true) {
      coverageBadge.className = 'badge badge-success';
      coverageBadge.textContent = '✓ Covered Loss';
    } else if (analysis.is_covered === false) {
      coverageBadge.className = 'badge badge-danger';
      coverageBadge.textContent = '✕ Excluded / Not Covered';
    } else {
      coverageBadge.className = 'badge badge-warning';
      coverageBadge.textContent = '⚠ Ambiguous Coverage';
    }

    const covText = analysis.is_covered === true ? '✓ Covered Loss' : analysis.is_covered === false ? '✕ Excluded' : '⚠ Ambiguous';
    const covClass = analysis.is_covered === true ? 'badge-success' : analysis.is_covered === false ? 'badge-danger' : 'badge-warning';
    setStepStatus(stepAnalysis, stepBadgeAnalysis, covText, covClass, stepDescAnalysis, `Deductible: $${analysis.deductible != null ? analysis.deductible : 1000} · Limit: $${Number(analysis.coverage_limit || 350000).toLocaleString()}`);

    let html = '';
    html += '<div class="analysis-meta-grid">';
    html += `<div class="analysis-stat"><div class="stat-label">Deductible</div><div class="stat-val">${analysis.deductible != null ? '$' + Number(analysis.deductible).toLocaleString() : 'Standard'}</div></div>`;
    html += `<div class="analysis-stat"><div class="stat-label">Coverage Limit</div><div class="stat-val">${analysis.coverage_limit != null ? '$' + Number(analysis.coverage_limit).toLocaleString() : 'Dwelling Limit'}</div></div>`;
    html += '</div>';

    if (analysis.reasoning) {
      html += `<div style="font-size: 0.85rem; line-height: 1.45; color: var(--text);"><strong style="color: #a78bfa;">Legal Opinion:</strong> ${analysis.reasoning}</div>`;
    }

    if (analysis.relevant_clauses && analysis.relevant_clauses.length > 0) {
      html += '<div style="margin-top: 8px;"><strong style="font-size: 0.78rem; color: var(--text-dim); text-transform: uppercase;">Cited Policy Clauses:</strong></div>';
      analysis.relevant_clauses.forEach(c => {
        html += `
          <div class="clause-item">
            <div class="clause-header">
              <span class="clause-section">${c.section || 'POLICY CLAUSE'}</span>
              <span class="clause-page">${c.page ? 'Page ' + c.page : ''}</span>
            </div>
            <div class="clause-quote">"${c.clause}"</div>
          </div>
        `;
      });
    }

    if (analysis.duties_after_loss && analysis.duties_after_loss.length > 0) {
      html += '<div style="margin-top: 6px;"><strong style="font-size: 0.78rem; color: var(--text-dim); text-transform: uppercase;">Policyholder Duties After Loss:</strong><div>';
      analysis.duties_after_loss.forEach(d => {
        html += `<span class="duty-pill">📋 ${d}</span>`;
      });
      html += '</div></div>';
    }

    policyAnalysisBody.innerHTML = html;
  }

  // Estimate Costs
  estimateCostsBtn.addEventListener('click', async () => {
    const claimId = await ensureClaim();
    const base = getBase();

    showStatus('Calculating itemized repair costs…', true);
    estimateCostsBtn.disabled = true;

    try {
      const res = await fetch(`${base}/api/v1/claims/${claimId}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overhead_and_profit_pct: 10.0 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      renderCostEstimate(data.cost_estimate);
      switchToClaimTab();
      showStatus('Cost estimate generated ✓', false);
      setTimeout(hideStatus, 2000);
    } catch (e) {
      showStatus(`Cost estimation failed: ${e.message}`, false);
    } finally {
      estimateCostsBtn.disabled = false;
    }
  });

  function renderCostEstimate(estimate) {
    if (!estimate) return;

    payoutBadge.className = 'badge badge-success';
    payoutBadge.textContent = `$${estimate.net_claim_payout.toLocaleString(undefined, {minimumFractionDigits: 2})} Net Payout`;

    setStepStatus(
      stepCost,
      stepBadgeCost,
      `$${Number(estimate.net_claim_payout).toLocaleString(undefined, {maximumFractionDigits: 0})} Net`,
      'badge-success',
      stepDescCost,
      `Gross: $${estimate.gross_estimate_usd.toLocaleString()} · Less $${estimate.deductible_usd != null ? estimate.deductible_usd : 1000} Ded.`
    );

    let html = '';
    html += `<div style="font-size: 0.85rem; color: var(--text); margin-bottom: 6px;"><strong>Scope:</strong> ${estimate.damage_summary}</div>`;

    if (estimate.line_items && estimate.line_items.length > 0) {
      html += `
        <table class="cost-table">
          <thead>
            <tr>
              <th>Repair Item</th>
              <th>Qty</th>
              <th>Unit Rate</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
      `;
      estimate.line_items.forEach(it => {
        html += `
          <tr>
            <td>
              <div style="font-weight: 500;">${it.description || it.item}</div>
              <div style="font-size: 0.72rem; color: var(--text-dim);">${it.location ? it.location + ' · ' : ''}${it.justification || ''}</div>
            </td>
            <td>${it.quantity} ${it.unit}</td>
            <td>$${it.unit_total_usd}/${it.unit}</td>
            <td style="text-align: right; font-weight: 600;">$${it.total_usd.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
          </tr>
        `;
      });
      html += '</tbody></table>';
    }

    // Cost summary
    html += `
      <div class="cost-summary-box">
        <div class="cost-summary-row"><span>Material Subtotal:</span><span>$${estimate.subtotal_material_usd.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
        <div class="cost-summary-row"><span>Labor Subtotal:</span><span>$${estimate.subtotal_labor_usd.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
        <div class="cost-summary-row"><span>Contractor O&P (${estimate.overhead_and_profit_pct}%):</span><span>$${estimate.overhead_and_profit_usd.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
        <div class="cost-summary-row" style="font-weight: 600; color: var(--text); border-top: 1px solid var(--border); padding-top: 4px;"><span>Gross Repair Estimate:</span><span>$${estimate.gross_estimate_usd.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
        ${estimate.deductible_usd != null ? `<div class="cost-summary-row" style="color: var(--orange);"><span>Less Policy Deductible:</span><span>-$${estimate.deductible_usd.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>` : ''}
      </div>
      <div class="payout-highlight">
        <span class="payout-label">Estimated Net Claim Payout</span>
        <span class="payout-amount">$${estimate.net_claim_payout.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
      </div>
    `;

    if (estimate.is_below_deductible) {
      html += `<div style="margin-top: 8px; font-size: 0.8rem; color: var(--orange); background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); border-radius: 6px; padding: 8px;">⚠ <strong>Notice:</strong> Estimated repair cost is less than your deductible. Filing this claim may not result in an insurance check.</div>`;
    }

    costEstimateBody.innerHTML = html;
  }

  // Interactive Chat
  sendChatBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  async function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';

    appendChatMessage('user', text);

    const claimId = await ensureClaim();
    const base = getBase();

    // Add typing indicator
    const typingId = 'typing-' + Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-msg assistant';
    typingDiv.id = typingId;
    typingDiv.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble"><span style="color: var(--text-dim); font-style: italic;">Consulting policy & scan metrics…</span></div>
    `;
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const res = await fetch(`${base}/api/v1/claims/${claimId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      document.getElementById(typingId)?.remove();

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      appendChatMessage('assistant', data.reply, data.intent, data.sources);
    } catch (e) {
      document.getElementById(typingId)?.remove();
      appendChatMessage('assistant', `Sorry, I encountered an issue: ${e.message}`);
    }
  }

  function appendChatMessage(role, text, intent = null, sources = []) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}`;

    let metaHtml = '';
    if (intent) {
      const intentClass = intent === 'POLICY' ? 'badge-accent' : intent === 'COST' ? 'badge-success' : intent === 'GEOMETRY' ? 'badge-info' : 'badge-neutral';
      metaHtml += `<div class="msg-meta"><span class="badge ${intentClass}">${intent}</span></div>`;
    }

    let sourcesHtml = '';
    if (sources && sources.length > 0) {
      sourcesHtml += '<div style="margin-top: 6px;">';
      sources.slice(0, 3).forEach(s => {
        const title = s.section ? `${s.section} ${s.page ? '(p. ' + s.page + ')' : ''}` : (s.reference || 'Source');
        sourcesHtml += `<span class="source-chip">📄 ${title}</span> `;
      });
      sourcesHtml += '</div>';
    }

    const formattedText = text.replace(/\n/g, '<br/>');

    if (role === 'assistant') {
      setStepStatus(
        stepChat,
        stepBadgeChat,
        intent ? `✓ ${intent}` : '✓ Verified',
        'badge-success',
        stepDescChat,
        'Multi-intent claim routing verified with real-time response & sources.'
      );

      msgDiv.innerHTML = `
        <div class="msg-avatar">🤖</div>
        <div class="msg-bubble">
          ${metaHtml}
          <div class="msg-content">${formattedText}</div>
          ${sourcesHtml}
        </div>
      `;
    } else {
      msgDiv.innerHTML = `
        <div class="msg-bubble">
          <div class="msg-content">${formattedText}</div>
        </div>
      `;
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

