const $ = (sel) => document.querySelector(sel);
const urlInput = $('#urlInput');
const fetchBtn = $('#fetchBtn');
const statusEl = $('#status');
const cardEl = $('#resultCard');
const titleEl = $('#title');
const bylineEl = $('#byline');
const imgEl = $('#coverImg');
const skeletonEl = $('#skeleton');
const downloadOriginal = $('#downloadOriginal');
const enhanceBtn = $('#enhanceBtn');

function setStatus(msg, isError = false) {
  statusEl.textContent = msg || '';
  statusEl.className = isError ? 'status error' : 'status';
}

function showSkeleton(show) {
  skeletonEl.style.display = show ? 'block' : 'none';
  imgEl.style.display = show ? 'none' : 'block';
}

function showCard(show) {
  cardEl.style.display = show ? 'block' : 'none';
}

function downloadURL(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderResult(data) {
  const img = (data.images || [])[0];
  titleEl.textContent = data.title || '';
  bylineEl.textContent = data.byline || '';

  if (!img) {
    showCard(false);
    setStatus('No 640×640 cover found for this item.', true);
    return;
  }
  showCard(true);
  showSkeleton(true);
  imgEl.onload = () => showSkeleton(false);
  imgEl.onerror = () => { showSkeleton(false); setStatus('Failed to load cover preview', true); };
  imgEl.src = img.url;

  const safeName = `${(data.title || data.type || 'cover')}`.replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/gi, '');
  downloadOriginal.onclick = () => {
    downloadURL(img.url, `${safeName}_640x640.jpg`);
    setStatus('Original image downloaded!');
  };
  enhanceBtn.onclick = async () => {
    try {
      setStatus('Enhancing image...');
      enhanceBtn.disabled = true;
      enhanceBtn.textContent = 'Enhancing...';
      
      const r = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: img.url })
      });
      
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Enhance failed (${r.status})`);
      }
      
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      downloadURL(url, `${safeName}_enhanced_3000x3000.jpg`);
      URL.revokeObjectURL(url);
      
      setStatus('Enhanced image downloaded successfully!');
    } catch (err) {
      setStatus(err.message || 'Enhance failed', true);
    } finally {
      enhanceBtn.disabled = false;
      enhanceBtn.textContent = 'Enhance & Download';
    }
  };
}

async function fetchCover(link) {
  setStatus('Fetching cover...');
  showCard(false);
  
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching...';
  
  try {
    const params = new URLSearchParams({ url: link });
    const res = await fetch(`/api/cover?${params.toString()}`);
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Request failed');
    
    if (!data.images || data.images.length === 0) {
      setStatus('No images available for this item.', true);
      return;
    }
    
    renderResult(data);
    setStatus('');
  } catch (err) {
    showCard(false);
    setStatus(err.message || 'Error fetching images', true);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Get Cover';
  }
}

fetchBtn.addEventListener('click', () => {
  const link = urlInput.value.trim();
  if (!link) return setStatus('Please paste a Spotify link or URI.', true);
  fetchCover(link);
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    fetchBtn.click();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  urlInput.focus();
});

urlInput.addEventListener('input', () => {
  if (statusEl.textContent) {
    setStatus('');
  }
});

urlInput.addEventListener('paste', (e) => {
  setTimeout(() => {
    const value = urlInput.value.trim();
    if (value && (value.includes('spotify.com') || value.startsWith('spotify:'))) {
      fetchCover(value);
    }
  }, 50);
});
