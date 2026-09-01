// =============================================
//  TWIBBON PKKMB 2026 - Script Utama
// =============================================

// ── KONFIGURASI SUPABASE ──────────────────────
const SUPABASE_URL   = 'https://mwqkzuodfpzrpnjijqnz.supabase.co';
const SUPABASE_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13cWt6dW9kZnB6cnBuamlqcW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDM1MTAsImV4cCI6MjEwMjgxOTUxMH0.1coY9tNoI9WcOZ6zzlwqYd6umDnf2TPJzTYq7wVsvr4';
const BUCKET_NAME    = 'twibbon-results';
const GALLERY_BUCKET = 'twibbon-gallery';
const GALLERY_MAX_MB = 0.3;  // maks 300KB per foto galeri (hemat bandwidth)
const GALLERY_PAGE   = 6;    // kurangi foto per halaman

// ── KONFIGURASI BINGKAI ───────────────────────
const FRAME = {
    cx:     1069,
    cy:     1169,
    w:      1085,
    h:      1036,
    rotate: -5.5,
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const toRad = d => d * Math.PI / 180;

// ── ELEMEN DOM ────────────────────────────────
const canvas      = document.getElementById('twibbonCanvas');
const ctx         = canvas.getContext('2d');
const uploadImage = document.getElementById('uploadImage');
const downloadBtn = document.getElementById('downloadBtn');
const uploadLabel = document.getElementById('uploadLabel');
const resetBtn    = document.getElementById('resetBtn');
const inputNama   = document.getElementById('inputNama');
const inputProdi  = document.getElementById('inputProdi');

// Virtual zoom (tidak ada slider di UI, dipakai logika pinch)
const zoom = { value: 1, min: 0.1, max: 3 };

// ── STATE ─────────────────────────────────────
let userImg        = null;
let twibbonRaw     = new Image();
let twibbonMask    = null;
let twibbonReady   = false; // flag template sudah siap
let userImgLoaded  = false;
let imgX = 0, imgY = 0, imgScale = 1, imgRotate = FRAME.rotate;
let isDragging = false, startX = 0, startY = 0;
let lastPinchDist = null;

// ── VISITOR COUNTER ───────────────────────────
trackVisitor();

async function trackVisitor() {
    try {
        // Pakai RPC atomic increment — tidak bisa race condition
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_visitor`, {
            method: 'POST',
            headers: {
                'apikey':        SUPABASE_ANON,
                'Authorization': `Bearer ${SUPABASE_ANON}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({}),
        });

        if (res.ok) {
            const count = await res.json();
            document.getElementById('visitorCount').textContent =
                Number(count).toLocaleString('id-ID');
        } else {
            document.getElementById('visitorCount').textContent = '—';
        }
    } catch (err) {
        console.warn('Visitor counter error:', err);
        document.getElementById('visitorCount').textContent = '—';
    }
}

// ── LOAD TEMPLATE ─────────────────────────────
(function loadTemplate() {
    const webp = new Image();
    webp.onload = () => initTemplate(webp);
    webp.onerror = () => {
        const png = new Image();
        png.onload  = () => initTemplate(png);
        png.onerror = () => console.error('Gagal load template');
        png.src = 'assets/img/pkkmb1.png';
    };
    webp.src = 'assets/img/pkkmb1.webp';
})();

function initTemplate(img) {
    twibbonRaw    = img;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    twibbonMask   = buildMaskedTemplate(img);
    twibbonReady  = true;
    drawCanvas();
    // Pastikan tombol download aktif setelah template siap
    document.getElementById('downloadBtn').disabled = false;
}

function buildMaskedTemplate(srcImg) {
    const oc   = document.createElement('canvas');
    oc.width   = srcImg.naturalWidth;
    oc.height  = srcImg.naturalHeight;
    const octx = oc.getContext('2d', { willReadFrequently: true });

    octx.drawImage(srcImg, 0, 0);
    octx.save();
    octx.globalCompositeOperation = 'destination-out';
    octx.translate(FRAME.cx, FRAME.cy);
    octx.rotate(toRad(FRAME.rotate));
    octx.fillStyle = '#000000';
    octx.beginPath();
    octx.rect(-FRAME.w / 2, -FRAME.h / 2, FRAME.w, FRAME.h);
    octx.fill();
    octx.restore();

    // Verifikasi mask berhasil — cek alpha pixel di tengah bingkai
    try {
        const px = octx.getImageData(FRAME.cx, FRAME.cy, 1, 1).data;
        if (px[3] !== 0) {
            console.warn('⚠️ destination-out tidak didukung di device ini, pakai fallback');
            return null;
        }
    } catch(e) {
        console.warn('getImageData gagal:', e);
        return null;
    }

    return oc;
}

// ── UPLOAD FOTO ───────────────────────────────
uploadImage.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        showError(`Ukuran foto ${(file.size/1024/1024).toFixed(1)} MB, melebihi batas 5 MB.`);
        uploadImage.value = ''; return;
    }
    if (!file.type.match(/image\/(jpeg|png|webp)/)) {
        showError('Format tidak didukung. Gunakan JPG, PNG, atau WEBP.');
        uploadImage.value = ''; return;
    }

    hideError();
    uploadLabel.textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;

    const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            userImg       = img;
            userImgLoaded = true;

            imgScale = Math.max(FRAME.w / img.naturalWidth, FRAME.h / img.naturalHeight);
            zoom.min   = imgScale * 0.5;
            zoom.max   = imgScale * 4;
            zoom.value = imgScale;

            imgX      = FRAME.cx - (img.naturalWidth  * imgScale) / 2;
            imgY      = FRAME.cy - (img.naturalHeight * imgScale) / 2;
            imgRotate = FRAME.rotate;

            resetBtn.style.display = 'flex';
            drawCanvas();
        };
        img.onerror = () => showError('Gagal membaca gambar.');
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

// ── HAPUS FOTO ────────────────────────────────
resetBtn.addEventListener('click', () => {
    userImg = null; userImgLoaded = false;
    uploadImage.value = '';
    uploadLabel.textContent = 'Belum ada foto dipilih';
    zoom.value = 1; zoom.min = 0.1; zoom.max = 3;
    imgRotate = FRAME.rotate;
    resetBtn.style.display = 'none';
    hideError();
    drawCanvas();
});

// ── VALIDASI INPUT ────────────────────────────
inputNama.addEventListener('input', () => {
    if (inputNama.value.trim()) { inputNama.classList.remove('error'); hideError(); }
});
inputProdi.addEventListener('input', () => {
    if (inputProdi.value.trim()) { inputProdi.classList.remove('error'); hideError(); }
});

// ── MOUSE DRAG ────────────────────────────────
canvas.addEventListener('mousedown', e => {
    if (!userImgLoaded) return;
    const pos = toCanvasCoords(e.clientX, e.clientY);
    if (!isInsideFrame(pos.x, pos.y)) return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('mousemove', e => {
    const pos = toCanvasCoords(e.clientX, e.clientY);
    if (!isDragging && userImgLoaded)
        canvas.style.cursor = isInsideFrame(pos.x, pos.y) ? 'grab' : 'default';
    if (!isDragging || !userImgLoaded) return;
    const rect = canvas.getBoundingClientRect();
    imgX += (e.clientX - startX) * (canvas.width  / rect.width);
    imgY += (e.clientY - startY) * (canvas.height / rect.height);
    startX = e.clientX; startY = e.clientY;
    drawCanvas();
});
canvas.addEventListener('mouseup',    () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; canvas.style.cursor = 'default'; });

// ── TOUCH DRAG + PINCH ZOOM ───────────────────
canvas.addEventListener('touchstart', e => {
    if (!userImgLoaded) return;

    if (e.touches.length === 1) {
        const pos = toCanvasCoords(e.touches[0].clientX, e.touches[0].clientY);
        // Hanya block scroll jika sentuh di dalam bingkai
        if (!isInsideFrame(pos.x, pos.y)) return;
        e.preventDefault();
        isDragging = true;
        const r = canvas.getBoundingClientRect();
        startX = e.touches[0].clientX - r.left;
        startY = e.touches[0].clientY - r.top;
    } else if (e.touches.length === 2) {
        // Pinch zoom selalu block scroll
        e.preventDefault();
        isDragging = false;
        lastPinchDist = pinchDist(e.touches);
    }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    if (!userImgLoaded) return;
    if (e.touches.length === 1 && isDragging) {
        e.preventDefault(); // block scroll hanya saat drag aktif
        const r  = canvas.getBoundingClientRect();
        const tx = e.touches[0].clientX - r.left;
        const ty = e.touches[0].clientY - r.top;
        imgX += (tx - startX) * (canvas.width  / r.width);
        imgY += (ty - startY) * (canvas.height / r.height);
        startX = tx; startY = ty;
        drawCanvas();
    } else if (e.touches.length === 2) {
        e.preventDefault(); // block scroll saat pinch zoom
        const nd = pinchDist(e.touches);
        if (!lastPinchDist) { lastPinchDist = nd; return; }
        const ns = Math.min(Math.max(imgScale * (nd / lastPinchDist), zoom.min), zoom.max);
        const r  = canvas.getBoundingClientRect();
        const mx = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left) * (canvas.width  / r.width);
        const my = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top)  * (canvas.height / r.height);
        imgX = mx - (mx - imgX) * (ns / imgScale);
        imgY = my - (my - imgY) * (ns / imgScale);
        imgScale = ns; zoom.value = ns;
        lastPinchDist = nd;
        drawCanvas();
    }
    // Jika tidak drag dan tidak pinch → tidak ada preventDefault → scroll normal
}, { passive: false });

canvas.addEventListener('touchend', () => { isDragging = false; lastPinchDist = null; });

// ── HELPER ────────────────────────────────────
function pinchDist(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function isInsideFrame(px, py) {
    const rad = toRad(-FRAME.rotate);
    const dx  = px - FRAME.cx, dy = py - FRAME.cy;
    const rx  = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry  = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(rx) <= FRAME.w / 2 && Math.abs(ry) <= FRAME.h / 2;
}

function toCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (canvas.width  / rect.width),
        y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
}

// ── DRAW CANVAS ───────────────────────────────
function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (userImgLoaded) {
        ctx.save();
        ctx.translate(FRAME.cx, FRAME.cy);
        ctx.rotate(toRad(FRAME.rotate));
        ctx.beginPath();
        ctx.rect(-FRAME.w / 2, -FRAME.h / 2, FRAME.w, FRAME.h);
        ctx.clip();
        ctx.rotate(toRad(-FRAME.rotate));
        ctx.translate(-FRAME.cx, -FRAME.cy);

        const fotoCx = imgX + (userImg.naturalWidth  * imgScale) / 2;
        const fotoCy = imgY + (userImg.naturalHeight * imgScale) / 2;
        ctx.translate(fotoCx, fotoCy);
        ctx.rotate(toRad(imgRotate));
        ctx.translate(-fotoCx, -fotoCy);

        ctx.drawImage(userImg, imgX, imgY,
            userImg.naturalWidth * imgScale, userImg.naturalHeight * imgScale);
        ctx.restore();
    }

    if (twibbonMask) ctx.drawImage(twibbonMask, 0, 0, canvas.width, canvas.height);
    else if (twibbonRaw.complete) ctx.drawImage(twibbonRaw, 0, 0, canvas.width, canvas.height);
}

// ── DOWNLOAD + SUPABASE ───────────────────────
downloadBtn.addEventListener('click', async () => {
    if (!userImgLoaded) { showError('Upload foto dulu!'); return; }
    if (!twibbonReady)  { showError('Template belum siap, tunggu sebentar lalu coba lagi.'); return; }

    const nama  = inputNama.value.trim();
    const prodi = inputProdi.value.trim();

    if (!nama) {
        inputNama.classList.add('error'); inputNama.focus();
        showError('Tulis nama kamu dulu sebelum download!'); return;
    }
    if (!prodi) {
        inputProdi.classList.add('error'); inputProdi.focus();
        showError('Tulis program studi kamu dulu!'); return;
    }
    inputNama.classList.remove('error');
    inputProdi.classList.remove('error');
    hideError();

    const exp = document.createElement('canvas');
    exp.width = canvas.width; exp.height = canvas.height;
    const ec  = exp.getContext('2d');

    ec.save();
    ec.translate(FRAME.cx, FRAME.cy);
    ec.rotate(toRad(FRAME.rotate));
    ec.beginPath();
    ec.rect(-FRAME.w / 2, -FRAME.h / 2, FRAME.w, FRAME.h);
    ec.clip();
    ec.rotate(toRad(-FRAME.rotate));
    ec.translate(-FRAME.cx, -FRAME.cy);
    const fx = imgX + (userImg.naturalWidth  * imgScale) / 2;
    const fy = imgY + (userImg.naturalHeight * imgScale) / 2;
    ec.translate(fx, fy); ec.rotate(toRad(imgRotate)); ec.translate(-fx, -fy);
    ec.drawImage(userImg, imgX, imgY, userImg.naturalWidth * imgScale, userImg.naturalHeight * imgScale);
    ec.restore();
    if (twibbonMask) ec.drawImage(twibbonMask, 0, 0, exp.width, exp.height);
    else              ec.drawImage(twibbonRaw,  0, 0, exp.width, exp.height);

    // Resize ke maks 1080px untuk hemat ukuran file (~500KB-1MB)
    const MAX_EXPORT = 1080;
    const exportRatio = Math.min(MAX_EXPORT / exp.width, MAX_EXPORT / exp.height, 1);
    const exportW = Math.round(exp.width  * exportRatio);
    const exportH = Math.round(exp.height * exportRatio);
    const resized = document.createElement('canvas');
    resized.width  = exportW;
    resized.height = exportH;
    resized.getContext('2d').drawImage(exp, 0, 0, exportW, exportH);
    const dataUrl = resized.toDataURL('image/jpeg', 0.92);

    // Deteksi HP (Android/iOS)
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
        // Di HP: buka gambar di tab baru agar bisa disimpan dengan tekan lama
        const win = window.open();
        if (win) {
            win.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <title>Twibbon PKKMB 2026</title>
                    <style>
                        body { margin:0; background:#000; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; font-family:sans-serif; }
                        img { max-width:100%; max-height:85vh; display:block; }
                        p { color:#fff; font-size:14px; margin-top:16px; text-align:center; padding:0 20px; }
                        strong { color:#fde68a; }
                    </style>
                </head>
                <body>
                    <img src="${dataUrl}" alt="Twibbon PKKMB 2026">
                    <p><strong>Tekan lama pada foto</strong> lalu pilih <strong>"Simpan Gambar"</strong> untuk menyimpan ke galeri HP kamu</p>
                </body>
                </html>
            `);
            win.document.close();
        } else {
            // Popup diblokir, fallback ke download biasa
            const link = document.createElement('a');
            link.download = 'Twibbon-PKKMB-2026.jpg';
            link.href = dataUrl;
            link.click();
        }
    } else {
        // Di desktop: download langsung
        const link = document.createElement('a');
        link.download = 'Twibbon-PKKMB-2026.jpg';
        link.href = dataUrl;
        link.click();
    }

    setDownloadState('loading');
    try {
        // Hanya upload ke galeri, tidak simpan foto asli agar hemat storage
        await uploadToGallery(exp, nama, prodi);
        setDownloadState('success');

        // Expand galeri dan scroll ke foto baru (delay agar prepend selesai dulu)
        setTimeout(() => scrollToGallery(), 100);
    } catch (err) {
        console.error(err);
        // Download sudah berhasil, gagal simpan ke galeri tidak perlu tampil error besar
        setDownloadState('done');
    }
});

async function uploadToSupabase() {
    const file = uploadImage.files[0];
    if (!file) throw new Error('File tidak ditemukan');
    const ext  = file.name.split('.').pop().toLowerCase();
    const rand = Math.random().toString(36).slice(2, 6);
    const res  = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/foto_${Date.now()}_${rand}.${ext}`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_ANON}`, 'apikey': SUPABASE_ANON, 'Content-Type': file.type, 'x-upsert': 'false' }, body: file }
    );
    if (!res.ok) throw new Error(await res.text());
}

function setDownloadState(state, errMsg = '') {
    const btn = document.getElementById('downloadBtn');
    const iconDown = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>';
    const labelNormal = iconDown + ' Download Twibbon (PNG Kualitas Penuh)';

    if (state === 'loading') {
        btn.disabled = true;
        btn.innerHTML = '<svg class="spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Menyimpan...';
    } else if (state === 'success') {
        btn.disabled = false;
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Tersimpan!';
        setTimeout(() => { btn.innerHTML = labelNormal; }, 3000);
    } else {
        // 'done' atau 'error' — download sudah berhasil, reset tombol saja
        btn.disabled = false;
        btn.innerHTML = labelNormal;
    }
}

function showError(msg) {
    let el = document.getElementById('errorMsg');
    if (!el) {
        el = document.createElement('p');
        el.id = 'errorMsg';
        el.style.cssText = 'color:#dc2626;font-size:13px;text-align:center;background:#fef2f2;padding:8px 12px;border-radius:8px;border:1px solid #fecaca;margin:0';
        document.querySelector('.controls').prepend(el);
    }
    el.textContent = msg; el.style.display = 'block';
}
function hideError() {
    const el = document.getElementById('errorMsg');
    if (el) el.style.display = 'none';
}

// ── SCROLL KE GALERI ─────────────────────────
function scrollToGallery() {
    const wrapper    = document.getElementById('galleryCollapseWrapper');
    const toggleBtn  = document.getElementById('galleryToggleBtn');
    const toggleText = document.getElementById('toggleText');

    // Expand galeri jika belum
    if (!galleryExpanded) {
        galleryExpanded = true;
        wrapper.classList.add('expanded');
        if (toggleBtn) toggleBtn.classList.add('expanded');
        if (toggleText) toggleText.textContent = 'Sembunyikan';
    }

    // Scroll ke foto terbaru (elemen pertama di grid = foto paling baru)
    setTimeout(() => {
        const firstItem = document.querySelector('#galleryGrid .gallery-item');
        if (firstItem) {
            firstItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            document.querySelector('.gallery-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 300);
}

// =============================================
//  GALERI TWIBBON
// =============================================

let galleryOffset = 0;
let galleryTotal  = 0;

loadGallery(true);

async function compressCanvas(srcCanvas) {
    const MAX_BYTES = GALLERY_MAX_MB * 1024 * 1024;
    const MAX_DIM   = 400;  // resolusi kecil untuk thumbnail galeri
    const ratio     = Math.min(MAX_DIM / srcCanvas.width, MAX_DIM / srcCanvas.height, 1);
    const w = Math.round(srcCanvas.width * ratio), h = Math.round(srcCanvas.height * ratio);
    const small = document.createElement('canvas');
    small.width = w; small.height = h;
    small.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
    for (let q = 0.85; q >= 0.3; q -= 0.1) {
        const blob = await new Promise(res => small.toBlob(res, 'image/jpeg', q));
        if (blob && blob.size <= MAX_BYTES) return blob;
    }
    return new Promise(res => small.toBlob(res, 'image/jpeg', 0.3));
}

async function uploadToGallery(exportCanvas, nama = 'Anonim', prodi = '') {
    const blob = await compressCanvas(exportCanvas);
    if (!blob) throw new Error('Gagal kompres gambar');
    const rand     = Math.random().toString(36).slice(2, 6);
    const fileName = 'twibbon_' + Date.now() + '_' + rand + '.jpg';
    const h = { 'Authorization': 'Bearer ' + SUPABASE_ANON, 'apikey': SUPABASE_ANON };

    // Retry upload storage maksimal 3x
    let uploadOk = false;
    let lastErr  = '';
    for (let i = 0; i < 3; i++) {
        try {
            const uploadRes = await fetch(SUPABASE_URL + '/storage/v1/object/' + GALLERY_BUCKET + '/' + fileName,
                { method: 'POST', headers: Object.assign({}, h, { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }), body: blob });
            if (uploadRes.ok) { uploadOk = true; break; }
            lastErr = await uploadRes.text();
        } catch(e) {
            lastErr = e.message;
            await new Promise(r => setTimeout(r, 1000 * (i + 1))); // tunggu 1s, 2s, 3s
        }
    }
    if (!uploadOk) throw new Error('Upload storage gagal: ' + lastErr);

    const fileUrl = SUPABASE_URL + '/storage/v1/object/public/' + GALLERY_BUCKET + '/' + fileName;

    // Simpan metadata dengan retry
    let metaOk = false;
    for (let i = 0; i < 3; i++) {
        try {
            const metaRes = await fetch(SUPABASE_URL + '/rest/v1/gallery',
                { method: 'POST', headers: Object.assign({}, h, { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
                  body: JSON.stringify({ file_name: fileName, file_url: fileUrl, name: nama, prodi: prodi }) });
            if (metaRes.ok) { metaOk = true; break; }
        } catch(e) {
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }

    // Tampilkan ke galeri meski metadata gagal (foto sudah tersimpan)
    prependGalleryItem({ file_url: fileUrl, name: nama, prodi: prodi });
    updateGalleryCount(galleryTotal + 1);

    if (!metaOk) console.warn('Metadata galeri gagal disimpan, tapi foto sudah terupload');
}

async function loadGallery(reset) {
    const grid        = document.getElementById('galleryGrid');
    const loadMoreBtn = document.getElementById('loadMoreBtn');

    if (reset) {
        galleryOffset  = 0;
        grid.innerHTML = '<div class="gallery-loading" id="galleryLoading"><div class="spinner"></div><span>Memuat galeri...</span></div>';
    }

    try {
        const countRes = await fetch(SUPABASE_URL + '/rest/v1/gallery?select=count',
            { headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON, 'apikey': SUPABASE_ANON, 'Prefer': 'count=exact', 'Range': '0-0' } });
        const cr = countRes.headers.get('Content-Range');
        galleryTotal = cr ? (parseInt(cr.split('/')[1]) || 0) : 0;
        updateGalleryCount(galleryTotal);

        const dataRes = await fetch(
            SUPABASE_URL + '/rest/v1/gallery?select=file_url,name,prodi,created_at&order=created_at.desc&limit=' + GALLERY_PAGE + '&offset=' + galleryOffset,
            { headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON, 'apikey': SUPABASE_ANON } });
        const data = await dataRes.json();

        var ldEl = document.getElementById('galleryLoading');
        if (ldEl) ldEl.remove();

        if (data.length === 0 && galleryOffset === 0) {
            grid.innerHTML = '<div class="gallery-empty">Belum ada twibbon. Jadilah yang pertama!</div>';
            loadMoreBtn.style.display = 'none';
            document.getElementById('galleryToggleBtn').style.display = 'none';
            document.getElementById('galleryCollapseWrapper').classList.add('expanded');
            return;
        }

        data.forEach(function(item) {
            grid.appendChild(createGalleryEl(item.file_url, item.name || '', item.prodi || ''));
        });
        galleryOffset += data.length;
        loadMoreBtn.style.display = 'none'; // sembunyikan, pakai tombol Lihat Semua saja

        const toggleBtn = document.getElementById('galleryToggleBtn');
        if (galleryTotal > 6) {
            toggleBtn.style.display = 'flex';
        } else {
            toggleBtn.style.display = 'none';
            document.getElementById('galleryCollapseWrapper').classList.add('expanded');
        }
    } catch (err) {
        console.error('Gagal load galeri:', err);
        var ldEl2 = document.getElementById('galleryLoading');
        if (ldEl2) ldEl2.remove();
    }
}

function prependGalleryItem(item) {
    const grid = document.getElementById('galleryGrid');
    var empty = grid.querySelector('.gallery-empty');
    if (empty) empty.remove();
    grid.insertBefore(createGalleryEl(item.file_url, item.name || '', item.prodi || ''), grid.firstChild);
}

function createGalleryEl(url, nama, prodi) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    const img = document.createElement('img');
    img.className = 'loading';
    img.alt = nama || 'Twibbon PKKMB 2026';
    img.loading = 'lazy';
    img.onload  = function() { img.classList.remove('loading'); img.classList.add('loaded'); };
    img.onerror = function() { div.style.display = 'none'; };
    img.src = url;
    div.appendChild(img);
    if (nama) {
        const nameEl = document.createElement('div');
        nameEl.className = 'gallery-name';
        nameEl.textContent = nama;
        if (prodi) {
            const s = document.createElement('span');
            s.textContent = prodi;
            nameEl.appendChild(s);
        }
        div.appendChild(nameEl);
    }
    div.addEventListener('click', function() { openLightbox(url, nama, prodi); });
    return div;
}

function updateGalleryCount(total) {
    galleryTotal = total;
    const el = document.getElementById('galleryCount');
    if (el) el.textContent = total + ' twibbon dibuat';
}

function openLightbox(url, nama, prodi) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px';
    const img = document.createElement('img');
    img.src = url; img.alt = nama || 'Twibbon';
    wrap.appendChild(img);
    if (nama) {
        const info = document.createElement('div');
        info.style.cssText = 'text-align:center';
        info.innerHTML = '<p style="color:#fff;font-size:14px;font-weight:700;margin:0">' + nama + '</p>' + (prodi ? '<p style="color:rgba(255,255,255,0.7);font-size:12px;margin:2px 0 0">' + prodi + '</p>' : '');
        wrap.appendChild(info);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.innerHTML = 'x';
    closeBtn.onclick = function() { lb.remove(); };
    lb.appendChild(wrap); lb.appendChild(closeBtn);
    lb.addEventListener('click', function(e) { if (e.target === lb) lb.remove(); });
    document.body.appendChild(lb);
}

document.getElementById('loadMoreBtn').addEventListener('click', function() { loadGallery(false); });

document.getElementById('galleryRefreshBtn').addEventListener('click', async function() {
    const btn = document.getElementById('galleryRefreshBtn');
    btn.classList.add('spinning');
    await loadGallery(true);
    btn.classList.remove('spinning');
});

let galleryExpanded = false;
document.getElementById('galleryToggleBtn').addEventListener('click', async () => {
    galleryExpanded = !galleryExpanded;
    const wrapper    = document.getElementById('galleryCollapseWrapper');
    const toggleBtn  = document.getElementById('galleryToggleBtn');
    const toggleText = document.getElementById('toggleText');

    if (galleryExpanded) {
        wrapper.classList.add('expanded');
        toggleBtn.classList.add('expanded');
        toggleText.textContent = 'Sembunyikan';

        // Load semua sisa data dulu kalau masih ada
        while (galleryOffset < galleryTotal) {
            await loadGallery(false);
        }

        // Sembunyikan tombol Load More karena sudah semua
        document.getElementById('loadMoreBtn').style.display = 'none';

        // Scroll ke bawah galeri setelah expand
        setTimeout(() => {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);

    } else {
        wrapper.classList.remove('expanded');
        toggleBtn.classList.remove('expanded');
        toggleText.textContent = 'Lihat Semua Twibbon';
        document.querySelector('.gallery-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});
