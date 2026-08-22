// =============================================
//  TWIBBON PKKMB 2026 - Script Utama
// =============================================

// ── KONFIGURASI SUPABASE ──────────────────────
const SUPABASE_URL    = 'https://mwqkzuodfpzrpnjijqnz.supabase.co';
const SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13cWt6dW9kZnB6cnBuamlqcW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDM1MTAsImV4cCI6MjEwMjgxOTUxMH0.1coY9tNoI9WcOZ6zzlwqYd6umDnf2TPJzTYq7wVsvr4';
const BUCKET_NAME     = 'twibbon-results';
const GALLERY_BUCKET  = 'twibbon-gallery';
const GALLERY_MAX_MB  = 2;        // maks ukuran file galeri (MB)
const GALLERY_PAGE    = 12;       // jumlah foto per halaman
// ─────────────────────────────────────────────

const canvas = document.getElementById('twibbonCanvas');
const ctx    = canvas.getContext('2d');
const uploadImage = document.getElementById('uploadImage');
const zoomSlider  = document.getElementById('zoomSlider');
const downloadBtn = document.getElementById('downloadBtn');
const uploadLabel = document.getElementById('uploadLabel');
const resetBtn       = document.getElementById('resetBtn');
// Slider zoom & rotasi disembunyikan dari UI tapi tetap dipakai oleh logika pinch/drag
const zoomSlider     = { value: 1, min: 0.1, max: 3 }; // virtual slider
const rotateSlider   = { value: FRAME.rotate };
const rotateValue    = null; // tidak ada di UI
const resetRotateBtn = null; // tidak ada di UI
const inputNama      = document.getElementById('inputNama');
const inputProdi     = document.getElementById('inputProdi');

// ── KONFIGURASI BINGKAI ───────────────────────
// Semua nilai piksel sesuai resolusi asli template
const FRAME = {
    cx:     1069,
    cy:     1169,
    w:      1085,
    h:      1036,
    rotate: -5.5,
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const toRad = d => d * Math.PI / 180;

// Hapus error border saat input diisi
inputNama.addEventListener('input', () => {
    if (inputNama.value.trim()) { inputNama.classList.remove('error'); hideError(); }
});
inputProdi.addEventListener('input', () => {
    if (inputProdi.value.trim()) { inputProdi.classList.remove('error'); hideError(); }
});

// ── Visitor Counter ───────────────────────────
async function trackVisitor() {
    try {
        const headers = {
            'apikey':        SUPABASE_ANON,
            'Authorization': `Bearer ${SUPABASE_ANON}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=representation',
        };

        // Increment count di Supabase via RPC update
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/visitors?id=eq.1`,
            {
                method:  'PATCH',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body:    JSON.stringify({ count: { increment: 1 } }),
            }
        );

        // Jika PATCH gagal (Supabase tidak support increment langsung),
        // ambil nilai lama dulu lalu update
        if (!res.ok) {
            const getRes  = await fetch(`${SUPABASE_URL}/rest/v1/visitors?id=eq.1&select=count`, { headers });
            const getData = await getRes.json();
            const current = getData[0]?.count ?? 0;
            const newCount = current + 1;

            await fetch(`${SUPABASE_URL}/rest/v1/visitors?id=eq.1`, {
                method:  'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body:    JSON.stringify({ count: newCount }),
            });

            document.getElementById('visitorCount').textContent = newCount.toLocaleString('id-ID');
        } else {
            const data = await res.json();
            const count = data[0]?.count ?? 0;
            document.getElementById('visitorCount').textContent = count.toLocaleString('id-ID');
        }
    } catch (err) {
        console.warn('Visitor counter error:', err);
        document.getElementById('visitorCount').textContent = '—';
    }
}

// Jalankan saat halaman dibuka
trackVisitor();

// ── State ─────────────────────────────────────
let userImg       = null;
let twibbonRaw    = new Image();   // template asli
let twibbonMask   = null;          // offscreen canvas template dgn lubang transparan
let userImgLoaded = false;
let imgX = 0, imgY = 0, imgScale = 1, imgRotate = 0;
let isDragging = false, startX = 0, startY = 0;
let lastPinchDist = null;

// ── 1. Load & Proses Template ─────────────────
// ── 1. Load & Proses Template ─────────────────
// Coba WebP dulu (58% lebih ringan), fallback ke PNG
function loadTemplate() {
    return new Promise((resolve) => {
        const webp = new Image();
        webp.onload  = () => resolve(webp);
        webp.onerror = () => {
            const png = new Image();
            png.onload  = () => resolve(png);
            png.onerror = () => console.error('❌ Gagal load template');
            png.src = 'assets/img/pkkmb1.png';
        };
        webp.src = 'assets/img/pkkmb1.webp';
    });
}

loadTemplate().then(img => {
    twibbonRaw    = img;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    twibbonMask   = buildMaskedTemplate(img);
    drawCanvas();
    console.log(`✅ Template loaded: ${canvas.width}×${canvas.height}`);
});

/**
 * Buat offscreen canvas template dengan lubang transparan di area bingkai
 * menggunakan destination-out compositing — akurat 100% tanpa flood fill
 */
function buildMaskedTemplate(srcImg) {
    const oc   = document.createElement('canvas');
    oc.width   = srcImg.naturalWidth;
    oc.height  = srcImg.naturalHeight;
    const octx = oc.getContext('2d');

    // Gambar template asli
    octx.drawImage(srcImg, 0, 0);

    // Hapus area bingkai dengan destination-out
    // (menggambar di area ini akan menghapus pixel menjadi transparan)
    octx.save();
    octx.globalCompositeOperation = 'destination-out';
    octx.translate(FRAME.cx, FRAME.cy);
    octx.rotate(toRad(FRAME.rotate));
    octx.fillStyle = 'rgba(0,0,0,1)';
    octx.fillRect(-FRAME.w / 2, -FRAME.h / 2, FRAME.w, FRAME.h);
    octx.restore();

    console.log('✅ Mask dibuat dengan destination-out');
    return oc;
}

// ── 2. Upload Foto ────────────────────────────
uploadImage.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        showError(`Ukuran foto ${(file.size/1024/1024).toFixed(1)} MB, melebihi batas 5 MB.`);
        uploadImage.value = '';
        return;
    }
    if (!file.type.match(/image\/(jpeg|png|webp)/)) {
        showError('Format tidak didukung. Gunakan JPG, PNG, atau WEBP.');
        uploadImage.value = '';
        return;
    }

    hideError();
    uploadLabel.textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;

    const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            userImg       = img;
            userImgLoaded = true;

            // Scale awal: foto cover seluruh bingkai
            imgScale = Math.max(FRAME.w / img.naturalWidth, FRAME.h / img.naturalHeight);

            zoomSlider.min   = (imgScale * 0.5).toFixed(5);
            zoomSlider.max   = (imgScale * 4).toFixed(5);
            zoomSlider.step  = 0.00001;
            zoomSlider.value = imgScale;

            // Posisi awal: foto di tengah bingkai
            imgX = FRAME.cx - (img.naturalWidth  * imgScale) / 2;
            imgY = FRAME.cy - (img.naturalHeight * imgScale) / 2;

            // Tampilkan tombol hapus
            resetBtn.style.display = 'flex';

            // Reset rotasi saat foto baru — ikuti kemiringan bingkai
            imgRotate = FRAME.rotate;
            rotateSlider.value = FRAME.rotate;

            if (userImgLoaded) drawCanvas();
        };
        img.onerror = () => showError('Gagal membaca gambar.');
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

// ── Slider Rotate (disembunyikan dari UI, logika tetap jalan) ────
// rotateSlider & rotateValue adalah virtual object, tidak ada di DOM

// ── Reset / Hapus Foto ────────────────────────
resetBtn.addEventListener('click', () => {
    // Reset state foto
    userImg       = null;
    userImgLoaded = false;

    // Reset input file agar bisa pilih file yang sama lagi
    uploadImage.value = '';
    uploadLabel.textContent = 'Belum ada foto dipilih';

    // Reset zoom slider
    zoomSlider.min   = 0.1;
    zoomSlider.max   = 3;
    zoomSlider.value = 1;

    // Reset rotasi
    imgRotate = FRAME.rotate;
    rotateSlider.value      = FRAME.rotate;
    rotateValue.textContent = `${FRAME.rotate}°`;

    // Sembunyikan tombol hapus
    resetBtn.style.display = 'none';

    hideError();

    // Gambar ulang canvas (hanya template, tanpa foto)
    drawCanvas();
});

// ── 3. Slider Zoom ────────────────────────────
zoomSlider.addEventListener('input', e => {
    if (!userImgLoaded) return;
    const ns = parseFloat(e.target.value);
    // zoom dari pusat bingkai
    imgX = FRAME.cx - (FRAME.cx - imgX) * (ns / imgScale);
    imgY = FRAME.cy - (FRAME.cy - imgY) * (ns / imgScale);
    imgScale = ns;
    drawCanvas();
});

// ── 4. Mouse Drag ─────────────────────────────
canvas.addEventListener('mousedown', e => {
    if (!userImgLoaded) return;
    const pos = toCanvasCoords(e.clientX, e.clientY);
    if (!isInsideFrame(pos.x, pos.y)) return; // hanya drag jika klik di dalam bingkai
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('mousemove', e => {
    const pos = toCanvasCoords(e.clientX, e.clientY);
    // Ubah cursor saat hover di dalam bingkai
    if (!isDragging && userImgLoaded) {
        canvas.style.cursor = isInsideFrame(pos.x, pos.y) ? 'grab' : 'default';
    }
    if (!isDragging || !userImgLoaded) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    imgX += (e.clientX - startX) * sx;
    imgY += (e.clientY - startY) * sy;
    startX = e.clientX; startY = e.clientY;
    drawCanvas();
});
canvas.addEventListener('mouseup',    () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; canvas.style.cursor = 'default'; });

// ── 5. Touch Drag + Pinch Zoom ────────────────
canvas.addEventListener('touchstart', e => {
    if (!userImgLoaded) return;
    e.preventDefault();
    if (e.touches.length === 1) {
        const pos = toCanvasCoords(e.touches[0].clientX, e.touches[0].clientY);
        if (!isInsideFrame(pos.x, pos.y)) return; // hanya drag jika sentuh di dalam bingkai
        isDragging = true;
        const r = canvas.getBoundingClientRect();
        startX = e.touches[0].clientX - r.left;
        startY = e.touches[0].clientY - r.top;
    } else if (e.touches.length === 2) {
        isDragging = false;
        lastPinchDist = pinchDist(e.touches);
    }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    if (!userImgLoaded) return;
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
        const r  = canvas.getBoundingClientRect();
        const tx = e.touches[0].clientX - r.left;
        const ty = e.touches[0].clientY - r.top;
        const sx = canvas.width  / r.width;
        const sy = canvas.height / r.height;
        imgX += (tx - startX) * sx;
        imgY += (ty - startY) * sy;
        startX = tx; startY = ty;
        drawCanvas();
    } else if (e.touches.length === 2) {
        const nd = pinchDist(e.touches);
        if (!lastPinchDist) { lastPinchDist = nd; return; }
        const ratio = nd / lastPinchDist;
        const ns = Math.min(Math.max(imgScale * ratio,
            parseFloat(zoomSlider.min)), parseFloat(zoomSlider.max));
        const r   = canvas.getBoundingClientRect();
        const mx  = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left) * (canvas.width  / r.width);
        const my  = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top)  * (canvas.height / r.height);
        imgX = mx - (mx - imgX) * (ns / imgScale);
        imgY = my - (my - imgY) * (ns / imgScale);
        imgScale = ns;
        zoomSlider.value = ns;
        lastPinchDist = nd;
        drawCanvas();
    }
}, { passive: false });

canvas.addEventListener('touchend', () => { isDragging = false; lastPinchDist = null; });

function pinchDist(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

/**
 * Cek apakah titik (px, py) dalam koordinat canvas
 * berada di dalam area bingkai FRAME (dengan rotasi)
 */
function isInsideFrame(px, py) {
    const dx  = px - FRAME.cx;
    const dy  = py - FRAME.cy;
    const rad = toRad(-FRAME.rotate);
    const rx  = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry  = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(rx) <= FRAME.w / 2 && Math.abs(ry) <= FRAME.h / 2;
}

/**
 * Konversi clientX/Y ke koordinat canvas
 */
function toCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (canvas.width  / rect.width),
        y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
}

// ── 6. Draw Canvas ────────────────────────────
function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Layer 1: foto user — di-clip ke area bingkai (rotated)
    if (userImgLoaded) {
        ctx.save();
        ctx.translate(FRAME.cx, FRAME.cy);
        ctx.rotate(toRad(FRAME.rotate));
        ctx.beginPath();
        ctx.rect(-FRAME.w / 2, -FRAME.h / 2, FRAME.w, FRAME.h);
        ctx.clip();
        ctx.rotate(toRad(-FRAME.rotate));
        ctx.translate(-FRAME.cx, -FRAME.cy);

        // Rotasi foto dari titik tengahnya sendiri
        const fotoCx = imgX + (userImg.naturalWidth  * imgScale) / 2;
        const fotoCy = imgY + (userImg.naturalHeight * imgScale) / 2;
        ctx.translate(fotoCx, fotoCy);
        ctx.rotate(toRad(imgRotate));
        ctx.translate(-fotoCx, -fotoCy);

        ctx.drawImage(userImg, imgX, imgY,
            userImg.naturalWidth * imgScale, userImg.naturalHeight * imgScale);
        ctx.restore();
    }

    // Layer 2: template dengan lubang transparan
    if (twibbonMask) {
        ctx.drawImage(twibbonMask, 0, 0, canvas.width, canvas.height);
    } else if (twibbonRaw.complete) {
        ctx.drawImage(twibbonRaw, 0, 0, canvas.width, canvas.height);
    }
}

// ── 7. Download + Simpan ke Supabase ─────────
downloadBtn.addEventListener('click', async () => {
    if (!userImgLoaded) { showError('Upload foto dulu!'); return; }

    // Validasi nama, fakultas, prodi
    const nama      = inputNama.value.trim();
    const prodi     = inputProdi.value.trim();

    if (!nama) {
        inputNama.classList.add('error');
        inputNama.focus();
        showError('Tulis nama kamu dulu sebelum download!');
        return;
    }
    if (!prodi) {
        inputProdi.classList.add('error');
        inputProdi.focus();
        showError('Tulis program studi kamu dulu!');
        return;
    }
    inputNama.classList.remove('error');
    inputProdi.classList.remove('error');
    hideError();

    // ── Render canvas offscreen resolusi penuh ──
    const exp    = document.createElement('canvas');
    exp.width    = canvas.width;
    exp.height   = canvas.height;
    const ec     = exp.getContext('2d');

    ec.save();
    ec.translate(FRAME.cx, FRAME.cy);
    ec.rotate(toRad(FRAME.rotate));
    ec.beginPath();
    ec.rect(-FRAME.w / 2, -FRAME.h / 2, FRAME.w, FRAME.h);
    ec.clip();
    ec.rotate(toRad(-FRAME.rotate));
    ec.translate(-FRAME.cx, -FRAME.cy);

    // Rotasi foto dari titik tengahnya
    const fotoCx = imgX + (userImg.naturalWidth  * imgScale) / 2;
    const fotoCy = imgY + (userImg.naturalHeight * imgScale) / 2;
    ec.translate(fotoCx, fotoCy);
    ec.rotate(toRad(imgRotate));
    ec.translate(-fotoCx, -fotoCy);

    ec.drawImage(userImg, imgX, imgY,
        userImg.naturalWidth * imgScale, userImg.naturalHeight * imgScale);
    ec.restore();

    if (twibbonMask) ec.drawImage(twibbonMask, 0, 0, exp.width, exp.height);
    else              ec.drawImage(twibbonRaw,  0, 0, exp.width, exp.height);

    // ── Download ke perangkat ──
    const dataUrl = exp.toDataURL('image/png');
    const link    = document.createElement('a');
    link.download = 'Twibbon-PKKMB-2026.png';
    link.href     = dataUrl;
    link.click();

    // ── Upload ke Supabase Storage (foto asli tanpa template) ──
    setDownloadState('loading');
    try {
        // Upload foto asli ke bucket results
        await uploadToSupabase();
        // Upload hasil twibbon terkompresi ke galeri
        await uploadToGallery(exp, nama, prodi);
        setDownloadState('success');
    } catch (err) {
        console.error('Supabase upload gagal:', err);
        setDownloadState('error', err.message);
    }
});

/**
 * Upload foto ASLI user (tanpa template twibbon) ke Supabase Storage
 * Menggunakan file langsung dari input, bukan dari canvas
 */
async function uploadToSupabase() {
    // Ambil file asli dari input
    const file = uploadImage.files[0];
    if (!file) throw new Error('File tidak ditemukan');

    // Nama file unik: timestamp + random 4 char + ekstensi asli
    const ext      = file.name.split('.').pop().toLowerCase();
    const rand     = Math.random().toString(36).slice(2, 6);
    const fileName = `foto_${Date.now()}_${rand}.${ext}`;
    const endpoint = `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/${fileName}`;

    const res = await fetch(endpoint, {
        method:  'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_ANON}`,
            'apikey':        SUPABASE_ANON,
            'Content-Type':  file.type,
            'x-upsert':      'false',
        },
        body: file,  // langsung upload file asli
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text}`);

    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${fileName}`;
    console.log('✅ Foto asli tersimpan:', fileUrl);
    return fileUrl;
}

/** Ubah tampilan tombol download sesuai state */
function setDownloadState(state, errMsg = '') {
    const btn = document.getElementById('downloadBtn');
    if (state === 'loading') {
        btn.disabled = true;
        btn.innerHTML = `<svg class="spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Menyimpan...`;
    } else if (state === 'success') {
        btn.disabled = false;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Tersimpan!`;
        setTimeout(() => {
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg> Download Twibbon (PNG Kualitas Penuh)`;
        }, 3000);
    } else if (state === 'error') {
        btn.disabled = false;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg> Download Twibbon (PNG Kualitas Penuh)`;
        showError(`Download berhasil, tapi gagal simpan ke server: ${errMsg}`);
    }
}

// ── Helper Error ──────────────────────────────
function showError(msg) {
    let el = document.getElementById('errorMsg');
    if (!el) {
        el = document.createElement('p');
        el.id = 'errorMsg';
        el.style.cssText = 'color:#dc2626;font-size:13px;text-align:center;background:#fef2f2;padding:8px 12px;border-radius:8px;border:1px solid #fecaca;margin:0';
        document.querySelector('.controls').prepend(el);
    }
    el.textContent   = msg;
    el.style.display = 'block';
}
function hideError() {
    const el = document.getElementById('errorMsg');
    if (el) el.style.display = 'none';
}

// =============================================
//  GALERI TWIBBON
// =============================================

let galleryOffset = 0;
let galleryTotal  = 0;

// ── Load galeri saat halaman dibuka ──────────
loadGallery(true);

/**
 * Kompres canvas hasil twibbon menjadi JPEG maks GALLERY_MAX_MB
 * Kurangi kualitas secara bertahap sampai ukuran di bawah batas
 */
async function compressCanvas(srcCanvas) {
    const MAX_BYTES = GALLERY_MAX_MB * 1024 * 1024;

    // Resize canvas ke maks 800px (cukup untuk galeri)
    const MAX_DIM = 800;
    const ratio   = Math.min(MAX_DIM / srcCanvas.width, MAX_DIM / srcCanvas.height, 1);
    const w = Math.round(srcCanvas.width  * ratio);
    const h = Math.round(srcCanvas.height * ratio);

    const small  = document.createElement('canvas');
    small.width  = w;
    small.height = h;
    small.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);

    // Coba kualitas dari 0.85 turun sampai file <= 2MB
    for (let q = 0.85; q >= 0.3; q -= 0.1) {
        const blob = await new Promise(res =>
            small.toBlob(res, 'image/jpeg', q)
        );
        if (blob && blob.size <= MAX_BYTES) {
            console.log(`Galeri: ${(blob.size/1024/1024).toFixed(2)}MB @ quality ${q.toFixed(1)}`);
            return blob;
        }
    }

    // Fallback: kualitas terendah
    return new Promise(res => small.toBlob(res, 'image/jpeg', 0.3));
}

/**
 * Upload hasil twibbon terkompresi ke Supabase gallery bucket
 * dan simpan metadata ke tabel gallery
 */
async function uploadToGallery(exportCanvas, nama = 'Anonim', prodi = '') {
    const blob = await compressCanvas(exportCanvas);
    if (!blob) throw new Error('Gagal kompres gambar');

    const rand     = Math.random().toString(36).slice(2, 6);
    const fileName = `twibbon_${Date.now()}_${rand}.jpg`;
    const endpoint = `${SUPABASE_URL}/storage/v1/object/${GALLERY_BUCKET}/${fileName}`;

    const headers = {
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'apikey':        SUPABASE_ANON,
        'Content-Type':  'image/jpeg',
        'x-upsert':      'false',
    };

    // Upload file ke storage
    const uploadRes = await fetch(endpoint, { method: 'POST', headers, body: blob });
    if (!uploadRes.ok) {
        const t = await uploadRes.text();
        throw new Error(`Upload galeri: ${uploadRes.status} ${t}`);
    }

    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${GALLERY_BUCKET}/${fileName}`;

    // Simpan metadata ke tabel gallery
    const metaRes = await fetch(`${SUPABASE_URL}/rest/v1/gallery`, {
        method:  'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_ANON}`,
            'apikey':        SUPABASE_ANON,
            'Content-Type':  'application/json',
            'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ file_name: fileName, file_url: fileUrl, name: nama, prodi }),
    });

    if (!metaRes.ok) {
        const t = await metaRes.text();
        throw new Error(`Metadata galeri: ${metaRes.status} ${t}`);
    }

    console.log('✅ Galeri tersimpan:', fileUrl);

    // Tambah foto baru langsung ke grid tanpa reload
    prependGalleryItem({ file_url: fileUrl, name: nama, prodi });
    updateGalleryCount(galleryTotal + 1);

    return fileUrl;
}

/**
 * Ambil foto galeri dari Supabase (pagination)
 * @param {boolean} reset - true = mulai dari awal
 */
async function loadGallery(reset = false) {
    const grid       = document.getElementById('galleryGrid');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const loading    = document.getElementById('galleryLoading');

    if (reset) {
        galleryOffset = 0;
        grid.innerHTML = '';
        const ld = document.createElement('div');
        ld.className = 'gallery-loading';
        ld.id = 'galleryLoading';
        ld.innerHTML = '<div class="spinner"></div><span>Memuat galeri...</span>';
        grid.appendChild(ld);
    }

    try {
        // Hitung total dengan query count yang akurat
        const countRes = await fetch(
            `${SUPABASE_URL}/rest/v1/gallery?select=count`,
            {
                headers: {
                    'Authorization': `Bearer ${SUPABASE_ANON}`,
                    'apikey':        SUPABASE_ANON,
                    'Prefer':        'count=exact',
                    'Range':         '0-0',
                },
            }
        );
        const contentRange = countRes.headers.get('Content-Range');
        galleryTotal = contentRange ? parseInt(contentRange.split('/')[1]) || 0 : 0;
        updateGalleryCount(galleryTotal);

        // Ambil data dengan pagination, urutan terbaru dulu
        const dataRes = await fetch(
            `${SUPABASE_URL}/rest/v1/gallery?select=file_url,name,prodi,created_at&order=created_at.desc&limit=${GALLERY_PAGE}&offset=${galleryOffset}`,
            {
                headers: {
                    'Authorization': `Bearer ${SUPABASE_ANON}`,
                    'apikey':        SUPABASE_ANON,
                },
            }
        );
        const data = await dataRes.json();

        // Hapus loading spinner
        const ldEl = document.getElementById('galleryLoading');
        if (ldEl) ldEl.remove();

        if (data.length === 0 && galleryOffset === 0) {
            grid.innerHTML = '<div class="gallery-empty">Belum ada twibbon. Jadilah yang pertama! 🎉</div>';
            loadMoreBtn.style.display = 'none';
            return;
        }

        // Render foto
        data.forEach(item => appendGalleryItem(grid, item));
        galleryOffset += data.length;

        // Tampilkan tombol load more jika masih ada data
        loadMoreBtn.style.display = galleryOffset < galleryTotal ? 'block' : 'none';

        // Tampilkan tombol toggle jika foto lebih dari 6
        const toggleBtn = document.getElementById('galleryToggleBtn');
        if (galleryTotal > 6) {
            toggleBtn.style.display = 'flex';
        } else {
            toggleBtn.style.display = 'none';
            // Kalau <= 6, tidak perlu collapse
            document.getElementById('galleryCollapseWrapper').classList.add('expanded');
        }

    } catch (err) {
        console.error('Gagal load galeri:', err);
        const ldEl = document.getElementById('galleryLoading');
        if (ldEl) ldEl.innerHTML = '<span style="color:rgba(255,255,255,0.5)">Gagal memuat galeri</span>';
    }
}

/** Tambah item galeri ke grid (append = bawah) */
function appendGalleryItem(grid, item) {
    grid.appendChild(createGalleryEl(item.file_url, item.name || '', item.prodi || ''));
}

/** Tambah item galeri ke grid (prepend = paling depan) */
function prependGalleryItem(item) {
    const grid = document.getElementById('galleryGrid');
    const empty = grid.querySelector('.gallery-empty');
    if (empty) empty.remove();
    grid.insertBefore(createGalleryEl(item.file_url, item.name || '', item.prodi || ''), grid.firstChild);
}

/** Buat elemen gambar galeri */
function createGalleryEl(url, nama = '', prodi = '') {
    const div = document.createElement('div');
    div.className = 'gallery-item';

    const img = document.createElement('img');
    img.className = 'loading';
    img.alt = nama || 'Twibbon PKKMB 2026';
    img.loading = 'lazy';
    img.onload  = () => { img.classList.remove('loading'); img.classList.add('loaded'); };
    img.onerror = () => { div.style.display = 'none'; };
    img.src = url;

    div.appendChild(img);

    // Label nama + prodi di bawah foto
    if (nama) {
        const nameEl = document.createElement('div');
        nameEl.className = 'gallery-name';
        nameEl.textContent = nama;
        if (prodi) {
            const prodiEl = document.createElement('span');
            prodiEl.textContent = prodi;
            nameEl.appendChild(prodiEl);
        }
        div.appendChild(nameEl);
    }

    div.addEventListener('click', () => openLightbox(url, nama, prodi));
    return div;
}

/** Update teks total foto galeri */
function updateGalleryCount(total) {
    const el = document.getElementById('galleryCount');
    if (el) el.textContent = `${total} twibbon dibuat`;
}

function openLightbox(url, nama = '', prodi = '') {
    const lb  = document.createElement('div');
    lb.className = 'lightbox';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px';

    const img = document.createElement('img');
    img.src = url;
    img.alt = nama || 'Twibbon PKKMB 2026';
    wrap.appendChild(img);

    if (nama) {
        const infoEl = document.createElement('div');
        infoEl.style.cssText = 'text-align:center';
        infoEl.innerHTML = `<p style="color:#fff;font-size:14px;font-weight:700;margin:0">${nama}</p>${prodi ? `<p style="color:rgba(255,255,255,0.7);font-size:12px;margin:2px 0 0">${prodi}</p>` : ''}`;
        wrap.appendChild(infoEl);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = () => lb.remove();

    lb.appendChild(wrap);
    lb.appendChild(closeBtn);
    lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
    document.body.appendChild(lb);
}

// ── Tombol Load More ──────────────────────────
document.getElementById('loadMoreBtn').addEventListener('click', () => loadGallery(false));

// ── Tombol Refresh Galeri ─────────────────────
document.getElementById('galleryRefreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('galleryRefreshBtn');
    btn.classList.add('spinning');
    await loadGallery(true);
    btn.classList.remove('spinning');
});

// ── Tombol Toggle Expand/Collapse Galeri ──────
let galleryExpanded = false;
document.getElementById('galleryToggleBtn').addEventListener('click', () => {
    galleryExpanded = !galleryExpanded;
    const wrapper    = document.getElementById('galleryCollapseWrapper');
    const toggleBtn  = document.getElementById('galleryToggleBtn');
    const toggleText = document.getElementById('toggleText');

    if (galleryExpanded) {
        wrapper.classList.add('expanded');
        toggleBtn.classList.add('expanded');
        toggleText.textContent = 'Sembunyikan';
    } else {
        wrapper.classList.remove('expanded');
        toggleBtn.classList.remove('expanded');
        toggleText.textContent = 'Lihat Semua Twibbon';
        // Scroll kembali ke atas galeri
        document.querySelector('.gallery-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});
