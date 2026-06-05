(() => {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const state = {
        pages: [],
        currentPageIndex: -1,
        originalImage: null,
        currentFilter: 'original',
        brightness: 0,
        contrast: 0,
        rotation: 0,
        cameraStream: null,
        facingMode: 'environment',
        flashOn: false,
        batchMode: false,
        cropRatio: 'free',
    };

    // DOM Elements
    const els = {
        mainView: $('#mainView'),
        emptyState: $('#emptyState'),
        pageList: $('#pageList'),
        cameraView: $('#cameraView'),
        editorView: $('#editorView'),
        exportModal: $('#exportModal'),
        cropModal: $('#cropModal'),
        loadingOverlay: $('#loadingOverlay'),
        loadingText: $('#loadingText'),
        toast: $('#toast'),
        cameraFeed: $('#cameraFeed'),
        editorCanvas: $('#editorCanvas'),
        cropCanvas: $('#cropCanvas'),
        cropBox: $('#cropBox'),
        fileInput: $('#fileInput'),
        adjustSlider: $('#adjustSlider'),
        sliderPanel: $('#sliderPanel'),
        sliderLabel: $('#sliderLabel'),
        sliderValue: $('#sliderValue'),
        filterBar: $('#filterBar'),
        pdfName: $('#pdfName'),
        exportPageCount: $('#exportPageCount'),
    };

    // ==================== Utilities ====================

    function showToast(msg, duration = 2500) {
        els.toast.textContent = msg;
        els.toast.classList.remove('hidden');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => els.toast.classList.add('hidden'), duration);
    }

    function showLoading(text = 'Processing...') {
        els.loadingText.textContent = text;
        els.loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
        els.loadingOverlay.classList.add('hidden');
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    function dataURLtoBlob(dataURL) {
        const parts = dataURL.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bytes = atob(parts[1]);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }

    // ==================== Page Management ====================

    function updateUI() {
        const hasPages = state.pages.length > 0;
        els.emptyState.classList.toggle('hidden', hasPages);
        els.pageList.classList.toggle('hidden', !hasPages);
        $('#btnExport').disabled = !hasPages;

        if (hasPages) {
            renderPageList();
        }
    }

    function renderPageList() {
        els.pageList.innerHTML = '';
        state.pages.forEach((page, index) => {
            const card = document.createElement('div');
            card.className = 'page-card';
            card.draggable = true;
            card.dataset.index = index;

            card.innerHTML = `
                <img class="page-thumb" src="${page.thumbnail}" alt="Page ${index + 1}" loading="lazy">
                <div class="page-info">
                    <span class="page-number">Page ${index + 1}</span>
                    <div class="page-actions">
                        <button class="page-action-btn edit" data-index="${index}" title="Edit">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="page-action-btn delete" data-index="${index}" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;

            card.querySelector('.page-thumb').addEventListener('click', () => openEditor(index));
            card.querySelector('.edit').addEventListener('click', (e) => {
                e.stopPropagation();
                openEditor(index);
            });
            card.querySelector('.delete').addEventListener('click', (e) => {
                e.stopPropagation();
                deletePage(index);
            });

            // Drag and drop
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('dragenter', handleDragEnter);
            card.addEventListener('dragleave', handleDragLeave);
            card.addEventListener('drop', handleDrop);
            card.addEventListener('dragend', handleDragEnd);

            els.pageList.appendChild(card);
        });
    }

    // ==================== Drag & Drop ====================

    let dragSrcIndex = null;

    function handleDragStart(e) {
        dragSrcIndex = +this.dataset.index;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDragEnter(e) {
        e.preventDefault();
        this.classList.add('drag-over');
    }

    function handleDragLeave() {
        this.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        const targetIndex = +this.dataset.index;
        if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
            const [moved] = state.pages.splice(dragSrcIndex, 1);
            state.pages.splice(targetIndex, 0, moved);
            renderPageList();
            showToast('Page order updated');
        }
    }

    function handleDragEnd() {
        $$('.page-card').forEach(c => {
            c.classList.remove('dragging', 'drag-over');
        });
    }

    function deletePage(index) {
        state.pages.splice(index, 1);
        updateUI();
        showToast('Page deleted');
    }

    // ==================== Camera ====================

    async function openCamera() {
        els.cameraView.classList.remove('hidden');

        // Request orientation permission while still in user gesture context (iOS requirement).
        // Must happen BEFORE any other await, and must not block camera if it fails.
        const needsOrientationPermission =
            typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function';

        if (needsOrientationPermission) {
            try {
                await DeviceOrientationEvent.requestPermission();
            } catch {
                // Permission denied or failed — gauge will auto-hide via timeout
            }
        }

        try {
            const constraints = {
                video: {
                    facingMode: state.facingMode,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            };
            state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            els.cameraFeed.srcObject = state.cameraStream;
            startOrientationSensor();
        } catch (err) {
            showToast('Camera access denied');
            closeCamera();
        }
    }

    function closeCamera() {
        stopOrientationSensor();
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(t => t.stop());
            state.cameraStream = null;
        }
        els.cameraFeed.srcObject = null;
        els.cameraView.classList.add('hidden');
    }

    async function switchCamera() {
        state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(t => t.stop());
        }
        try {
            state.cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: state.facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false,
            });
            els.cameraFeed.srcObject = state.cameraStream;
        } catch {
            showToast('Cannot switch camera');
        }
    }

    async function capturePhoto() {
        const video = els.cameraFeed;
        if (!video.videoWidth) return;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');

        if (state.facingMode === 'user') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }

        ctx.drawImage(video, 0, 0);
        const dataURL = canvas.toDataURL('image/jpeg', 0.92);

        if (state.batchMode) {
            await addPage(dataURL);
            showToast(`Page ${state.pages.length} added`);
        } else {
            closeCamera();
            state.originalImage = dataURL;
            state.currentPageIndex = -1;
            resetEditorState();
            openEditorWithImage(dataURL);
        }
    }

    // ==================== File Upload ====================

    function handleFileUpload(files) {
        if (!files.length) return;

        const fileArray = Array.from(files);
        let processed = 0;

        if (fileArray.length > 1) {
            showLoading(`Processing ${fileArray.length} images...`);
        }

        fileArray.forEach(file => {
            if (!file.type.startsWith('image/')) {
                processed++;
                return;
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                processed++;
                if (fileArray.length > 1) {
                    await addPage(e.target.result);
                    els.loadingText.textContent = `Processing ${processed}/${fileArray.length}...`;
                    if (processed === fileArray.length) {
                        hideLoading();
                        updateUI();
                        showToast(`${state.pages.length} pages added`);
                    }
                } else {
                    state.originalImage = e.target.result;
                    state.currentPageIndex = -1;
                    resetEditorState();
                    openEditorWithImage(e.target.result);
                }
            };
            reader.readAsDataURL(file);
        });
    }

    function addPage(dataURL) {
        return new Promise((resolve) => {
            const thumbCanvas = document.createElement('canvas');
            const thumbSize = 300;
            const img = new Image();
            img.onload = () => {
                const ratio = img.width / img.height;
                if (ratio > 1) {
                    thumbCanvas.width = thumbSize;
                    thumbCanvas.height = thumbSize / ratio;
                } else {
                    thumbCanvas.height = thumbSize;
                    thumbCanvas.width = thumbSize * ratio;
                }
                thumbCanvas.getContext('2d').drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);

                state.pages.push({
                    fullImage: dataURL,
                    thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.7),
                    filter: 'original',
                    brightness: 0,
                    contrast: 0,
                    rotation: 0,
                });
                updateUI();
                resolve();
            };
            img.src = dataURL;
        });
    }

    // ==================== Editor ====================

    function resetEditorState() {
        state.currentFilter = 'original';
        state.brightness = 0;
        state.contrast = 0;
        state.rotation = 0;
    }

    function openEditor(index) {
        state.currentPageIndex = index;
        const page = state.pages[index];
        state.originalImage = page.fullImage;
        state.currentFilter = page.filter;
        state.brightness = page.brightness;
        state.contrast = page.contrast;
        state.rotation = page.rotation;
        openEditorWithImage(page.fullImage);
    }

    function openEditorWithImage(dataURL) {
        els.editorView.classList.remove('hidden');
        els.sliderPanel.classList.add('hidden');

        // Update filter buttons
        $$('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === state.currentFilter);
        });

        // Update filter previews with thumbnail
        const img = new Image();
        img.onload = () => {
            $$('.filter-preview').forEach(el => {
                el.style.backgroundImage = `url(${dataURL})`;
                el.style.backgroundSize = 'cover';
                el.style.backgroundPosition = 'center';
            });
        };
        img.src = dataURL;

        renderEditor();
    }

    async function renderEditor() {
        const img = await loadImage(state.originalImage);
        const canvas = els.editorCanvas;
        const ctx = canvas.getContext('2d');

        let w = img.width;
        let h = img.height;

        const rotated = state.rotation % 180 !== 0;
        canvas.width = rotated ? h : w;
        canvas.height = rotated ? w : h;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((state.rotation * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2);
        ctx.restore();

        applyFilters(ctx, canvas.width, canvas.height);
    }

    function applyFilters(ctx, width, height) {
        if (state.currentFilter === 'original' && state.brightness === 0 && state.contrast === 0) {
            return;
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const brightnessVal = state.brightness * 2.55;
        const contrastFactor = (259 * (state.contrast + 255)) / (255 * (259 - state.contrast));

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            // Brightness
            r += brightnessVal;
            g += brightnessVal;
            b += brightnessVal;

            // Contrast
            if (state.contrast !== 0) {
                r = contrastFactor * (r - 128) + 128;
                g = contrastFactor * (g - 128) + 128;
                b = contrastFactor * (b - 128) + 128;
            }

            // Filter
            switch (state.currentFilter) {
                case 'grayscale': {
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    r = g = b = gray;
                    break;
                }
                case 'enhanced': {
                    const enhanceFactor = 1.3;
                    r = enhanceFactor * (r - 128) + 128 + 10;
                    g = enhanceFactor * (g - 128) + 128 + 10;
                    b = enhanceFactor * (b - 128) + 128 + 10;
                    break;
                }
                case 'magic': {
                    const gray2 = 0.299 * r + 0.587 * g + 0.114 * b;
                    const threshold = 180;
                    if (gray2 > threshold) {
                        r = g = b = 255;
                    } else {
                        const magicFactor = 1.8;
                        r = magicFactor * (r - 128) + 128;
                        g = magicFactor * (g - 128) + 128;
                        b = magicFactor * (b - 128) + 128;
                        const avg = (r + g + b) / 3;
                        r = avg * 0.3 + r * 0.7;
                        g = avg * 0.3 + g * 0.7;
                        b = avg * 0.3 + b * 0.7;
                    }
                    break;
                }
            }

            data[i] = Math.max(0, Math.min(255, r));
            data[i + 1] = Math.max(0, Math.min(255, g));
            data[i + 2] = Math.max(0, Math.min(255, b));
        }

        ctx.putImageData(imageData, 0, 0);
    }

    async function saveEditorResult() {
        const canvas = els.editorCanvas;
        const dataURL = canvas.toDataURL('image/jpeg', 0.92);

        if (state.currentPageIndex >= 0) {
            const page = state.pages[state.currentPageIndex];
            page.fullImage = dataURL;
            page.filter = state.currentFilter;
            page.brightness = state.brightness;
            page.contrast = state.contrast;
            page.rotation = state.rotation;

            const thumbCanvas = document.createElement('canvas');
            const thumbSize = 300;
            const ratio = canvas.width / canvas.height;
            if (ratio > 1) {
                thumbCanvas.width = thumbSize;
                thumbCanvas.height = thumbSize / ratio;
            } else {
                thumbCanvas.height = thumbSize;
                thumbCanvas.width = thumbSize * ratio;
            }
            thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
            page.thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);
        } else {
            await addPage(dataURL);
        }

        els.editorView.classList.add('hidden');
        updateUI();
        showToast('Page saved');
    }

    // ==================== Auto Deskew (Smart) ====================

    function gaussianBlur(gray, w, h) {
        const kernel = [1, 4, 6, 4, 1];
        const kSum = 16;
        const tmp = new Float32Array(w * h);
        const out = new Float32Array(w * h);

        // Horizontal pass
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0;
                for (let k = -2; k <= 2; k++) {
                    const px = Math.min(w - 1, Math.max(0, x + k));
                    sum += gray[y * w + px] * kernel[k + 2];
                }
                tmp[y * w + x] = sum / kSum;
            }
        }
        // Vertical pass
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0;
                for (let k = -2; k <= 2; k++) {
                    const py = Math.min(h - 1, Math.max(0, y + k));
                    sum += tmp[py * w + x] * kernel[k + 2];
                }
                out[y * w + x] = sum / kSum;
            }
        }
        return out;
    }

    function computeEdgesWithDirection(gray, w, h) {
        const magnitude = new Float32Array(w * h);
        const direction = new Float32Array(w * h);

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const gx = -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
                         - 2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)]
                         - gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
                const gy = -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
                         + gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
                magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
                direction[idx] = Math.atan2(gy, gx);
            }
        }
        return { magnitude, direction };
    }

    function nonMaxSuppression(magnitude, direction, w, h) {
        const result = new Float32Array(w * h);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const mag = magnitude[idx];
                if (mag === 0) continue;

                let angle = direction[idx] * (180 / Math.PI);
                if (angle < 0) angle += 180;

                let n1 = 0, n2 = 0;
                if ((angle < 22.5) || (angle >= 157.5)) {
                    n1 = magnitude[y * w + (x + 1)];
                    n2 = magnitude[y * w + (x - 1)];
                } else if (angle < 67.5) {
                    n1 = magnitude[(y - 1) * w + (x + 1)];
                    n2 = magnitude[(y + 1) * w + (x - 1)];
                } else if (angle < 112.5) {
                    n1 = magnitude[(y - 1) * w + x];
                    n2 = magnitude[(y + 1) * w + x];
                } else {
                    n1 = magnitude[(y - 1) * w + (x - 1)];
                    n2 = magnitude[(y + 1) * w + (x + 1)];
                }

                result[idx] = (mag >= n1 && mag >= n2) ? mag : 0;
            }
        }
        return result;
    }

    function hysteresisThreshold(edges, w, h, lowRatio, highRatio) {
        let maxVal = 0;
        for (let i = 0; i < edges.length; i++) {
            if (edges[i] > maxVal) maxVal = edges[i];
        }
        const high = maxVal * highRatio;
        const low = maxVal * lowRatio;

        const result = new Uint8Array(w * h);
        for (let i = 0; i < edges.length; i++) {
            if (edges[i] >= high) result[i] = 2;
            else if (edges[i] >= low) result[i] = 1;
        }

        // Connect weak edges to strong edges
        let changed = true;
        while (changed) {
            changed = false;
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const idx = y * w + x;
                    if (result[idx] !== 1) continue;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (result[(y + dy) * w + (x + dx)] === 2) {
                                result[idx] = 2;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }

        const final = new Uint8Array(w * h);
        for (let i = 0; i < result.length; i++) {
            final[i] = result[i] === 2 ? 255 : 0;
        }
        return final;
    }

    function detectSkewAngle(canvas) {
        const w = canvas.width;
        const h = canvas.height;

        // Downscale for analysis
        const maxSize = 800;
        const scale = Math.min(1, maxSize / Math.max(w, h));
        const sw = Math.round(w * scale);
        const sh = Math.round(h * scale);

        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = sw;
        tmpCanvas.height = sh;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(canvas, 0, 0, sw, sh);

        const imageData = tmpCtx.getImageData(0, 0, sw, sh);
        const data = imageData.data;

        // Grayscale
        const rawGray = new Float32Array(sw * sh);
        for (let i = 0; i < rawGray.length; i++) {
            const idx = i * 4;
            rawGray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        }

        // Gaussian blur to reduce noise
        const gray = gaussianBlur(rawGray, sw, sh);

        // Canny-style edge detection
        const { magnitude, direction } = computeEdgesWithDirection(gray, sw, sh);
        const thinEdges = nonMaxSuppression(magnitude, direction, sw, sh);
        const edges = hysteresisThreshold(thinEdges, sw, sh, 0.05, 0.15);

        // Collect edge points — prioritize near-horizontal edges (text lines)
        const edgePoints = [];
        for (let y = Math.round(sh * 0.05); y < Math.round(sh * 0.95); y++) {
            for (let x = Math.round(sw * 0.05); x < Math.round(sw * 0.95); x++) {
                if (edges[y * sw + x] === 0) continue;
                const dir = direction[y * sw + x];
                const absDeg = Math.abs(dir * 180 / Math.PI);
                // Edges whose gradient is near-vertical → horizontal lines
                if (absDeg > 60 && absDeg < 120) {
                    edgePoints.push({ x, y, weight: 2.0 });
                } else {
                    edgePoints.push({ x, y, weight: 0.5 });
                }
            }
        }

        if (edgePoints.length < 20) return 0;

        // Sample for performance
        const maxPts = 8000;
        let pts = edgePoints;
        if (pts.length > maxPts) {
            pts = [];
            const step = edgePoints.length / maxPts;
            for (let i = 0; i < edgePoints.length; i += step) {
                pts.push(edgePoints[Math.floor(i)]);
            }
        }

        const cx = sw / 2;
        const cy = sh / 2;

        // Coarse sweep: -20° to +20° in 0.5° steps
        const coarseAngles = [];
        for (let a = -20; a <= 20; a += 0.5) coarseAngles.push(a);

        function projectionScore(angleDeg) {
            const rad = (angleDeg * Math.PI) / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);
            const buckets = new Map();
            for (const p of pts) {
                const proj = Math.round((p.x - cx) * sinA - (p.y - cy) * cosA);
                buckets.set(proj, (buckets.get(proj) || 0) + p.weight);
            }
            // Entropy-based scoring: variance of bucket counts
            let sum = 0, sumSq = 0, n = 0;
            for (const c of buckets.values()) {
                sum += c;
                sumSq += c * c;
                n++;
            }
            return n > 0 ? (sumSq / n) - (sum / n) * (sum / n) : 0;
        }

        // Coarse pass
        let bestAngle = 0;
        let bestScore = -1;
        for (const a of coarseAngles) {
            const s = projectionScore(a);
            if (s > bestScore) { bestScore = s; bestAngle = a; }
        }

        // Fine sweep: ±1° around best in 0.05° steps
        let fineAngles = [];
        for (let a = bestAngle - 1; a <= bestAngle + 1; a += 0.05) fineAngles.push(a);

        for (const a of fineAngles) {
            const s = projectionScore(a);
            if (s > bestScore) { bestScore = s; bestAngle = a; }
        }

        // Sub-step parabolic interpolation
        const step2 = 0.05;
        const sLeft = projectionScore(bestAngle - step2);
        const sCenter = projectionScore(bestAngle);
        const sRight = projectionScore(bestAngle + step2);
        const denom = sLeft - 2 * sCenter + sRight;
        if (Math.abs(denom) > 1e-10) {
            const delta = step2 * (sLeft - sRight) / (2 * denom);
            if (Math.abs(delta) < step2) bestAngle += delta;
        }

        return Math.round(bestAngle * 100) / 100;
    }

    async function autoDeskew() {
        showLoading('Analyzing document...');
        await new Promise(r => setTimeout(r, 50));

        try {
            const img = await loadImage(state.originalImage);
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = img.width;
            tmpCanvas.height = img.height;
            tmpCanvas.getContext('2d').drawImage(img, 0, 0);

            const angle = detectSkewAngle(tmpCanvas);

            if (Math.abs(angle) < 0.2) {
                hideLoading();
                showToast('Document is already straight (±0.2°)');
                return;
            }

            els.loadingText.textContent = `Straightening ${angle.toFixed(2)}°...`;
            await new Promise(r => setTimeout(r, 50));

            const radians = (-angle * Math.PI) / 180;
            const cos = Math.abs(Math.cos(radians));
            const sin = Math.abs(Math.sin(radians));
            const newW = Math.round(img.width * cos + img.height * sin);
            const newH = Math.round(img.width * sin + img.height * cos);

            const correctedCanvas = document.createElement('canvas');
            correctedCanvas.width = newW;
            correctedCanvas.height = newH;
            const ctx = correctedCanvas.getContext('2d');

            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, newW, newH);
            ctx.translate(newW / 2, newH / 2);
            ctx.rotate(radians);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);

            // Auto-crop white borders after rotation
            const cropData = ctx.getImageData(0, 0, newW, newH).data;
            let minX = newW, maxX = 0, minY = newH, maxY = 0;
            for (let y = 0; y < newH; y += 2) {
                for (let x = 0; x < newW; x += 2) {
                    const idx = (y * newW + x) * 4;
                    if (cropData[idx] < 250 || cropData[idx + 1] < 250 || cropData[idx + 2] < 250) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            const pad = 4;
            minX = Math.max(0, minX - pad);
            minY = Math.max(0, minY - pad);
            maxX = Math.min(newW, maxX + pad);
            maxY = Math.min(newH, maxY + pad);
            const cropW = maxX - minX;
            const cropH = maxY - minY;

            if (cropW > 50 && cropH > 50) {
                const finalCanvas = document.createElement('canvas');
                finalCanvas.width = cropW;
                finalCanvas.height = cropH;
                finalCanvas.getContext('2d').drawImage(correctedCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
                state.originalImage = finalCanvas.toDataURL('image/jpeg', 0.95);
            } else {
                state.originalImage = correctedCanvas.toDataURL('image/jpeg', 0.95);
            }

            state.rotation = 0;
            hideLoading();
            renderEditor();
            showToast(`Corrected ${Math.abs(angle).toFixed(2)}° skew`);
        } catch (err) {
            hideLoading();
            showToast('Failed to detect skew');
            console.error('Deskew error:', err);
        }
    }

    // ==================== Orientation Sensor ====================

    let orientationHandler = null;
    let orientationAvailable = null; // null = not tested, true/false
    let orientationCheckTimer = null;

    function startOrientationSensor() {
        const gauge = $('#orientationGauge');
        if (!gauge) return;

        // Always show gauge initially, hide only if no data arrives
        gauge.classList.remove('hidden');

        const bubble = $('#levelBubble');
        const axisX = $('#axisX');
        const axisY = $('#axisY');
        const axisZ = $('#axisZ');
        const warning = $('#tiltWarning');
        let receivedData = false;

        stopOrientationSensor();

        orientationHandler = (e) => {
            if (e.beta === null && e.gamma === null && e.alpha === null) return;
            receivedData = true;
            orientationAvailable = true;

            const beta = e.beta ?? 0;
            const gamma = e.gamma ?? 0;
            const alpha = e.alpha ?? 0;

            const xTilt = beta - 90;
            const yTilt = gamma;

            axisX.textContent = xTilt.toFixed(1) + '°';
            axisY.textContent = yTilt.toFixed(1) + '°';
            axisZ.textContent = alpha.toFixed(1) + '°';

            colorAxis(axisX, Math.abs(xTilt), 5, 15);
            colorAxis(axisY, Math.abs(yTilt), 3, 10);

            const bubblePos = 50 + Math.max(-50, Math.min(50, yTilt * (50 / 30)));
            bubble.style.left = bubblePos + '%';

            const totalTilt = Math.sqrt(xTilt * xTilt + yTilt * yTilt);
            bubble.classList.remove('warning', 'danger');
            if (totalTilt > 10) {
                bubble.classList.add('danger');
                warning.classList.remove('hidden');
            } else if (totalTilt > 4) {
                bubble.classList.add('warning');
                warning.classList.add('hidden');
            } else {
                warning.classList.add('hidden');
            }
        };

        window.addEventListener('deviceorientation', orientationHandler, true);

        // If no data within 3 seconds, sensor is not available — hide gauge
        orientationCheckTimer = setTimeout(() => {
            if (!receivedData) {
                orientationAvailable = false;
                gauge.classList.add('hidden');
            }
        }, 3000);

        function colorAxis(el, absVal, warnThreshold, dangerThreshold) {
            if (absVal > dangerThreshold) el.style.color = '#EF4444';
            else if (absVal > warnThreshold) el.style.color = '#FBBF24';
            else el.style.color = '#4ADE80';
        }
    }

    function stopOrientationSensor() {
        if (orientationHandler) {
            window.removeEventListener('deviceorientation', orientationHandler, true);
            orientationHandler = null;
        }
        if (orientationCheckTimer) {
            clearTimeout(orientationCheckTimer);
            orientationCheckTimer = null;
        }
    }

    // ==================== Crop ====================

    let cropState = { x: 0, y: 0, w: 0, h: 0, dragging: null, startX: 0, startY: 0 };

    function openCrop() {
        els.cropModal.classList.remove('hidden');
        const canvas = els.cropCanvas;
        const ctx = canvas.getContext('2d');
        const srcCanvas = els.editorCanvas;

        const wrapper = $('.crop-canvas-wrapper');
        const maxW = wrapper.clientWidth - 40;
        const maxH = wrapper.clientHeight - 40;
        const scale = Math.min(maxW / srcCanvas.width, maxH / srcCanvas.height, 1);

        canvas.width = srcCanvas.width * scale;
        canvas.height = srcCanvas.height * scale;
        ctx.drawImage(srcCanvas, 0, 0, canvas.width, canvas.height);

        // cropState uses percentages (0-1) relative to the canvas internal size
        cropState = {
            x: 0.05,
            y: 0.05,
            w: 0.9,
            h: 0.9,
        };
        updateCropBox();
    }

    function updateCropBox() {
        const canvas = els.cropCanvas;
        const rect = canvas.getBoundingClientRect();
        const wrapper = $('.crop-canvas-wrapper');
        const wrapperRect = wrapper.getBoundingClientRect();
        const box = els.cropBox;

        // Canvas offset relative to wrapper
        const offsetX = rect.left - wrapperRect.left;
        const offsetY = rect.top - wrapperRect.top;

        // Convert percentage crop state to pixel positions on the displayed canvas
        const pxX = cropState.x * rect.width;
        const pxY = cropState.y * rect.height;
        const pxW = cropState.w * rect.width;
        const pxH = cropState.h * rect.height;

        box.style.left = (offsetX + pxX) + 'px';
        box.style.top = (offsetY + pxY) + 'px';
        box.style.width = pxW + 'px';
        box.style.height = pxH + 'px';
    }

    function initCropHandlers() {
        const box = els.cropBox;
        const handles = box.querySelectorAll('.crop-handle');

        function getPos(e) {
            const touch = e.touches ? e.touches[0] : e;
            return { x: touch.clientX, y: touch.clientY };
        }

        function onStart(e, type) {
            e.preventDefault();
            const pos = getPos(e);
            cropState.dragging = type;
            cropState.startX = pos.x;
            cropState.startY = pos.y;
            cropState.origX = cropState.x;
            cropState.origY = cropState.y;
            cropState.origW = cropState.w;
            cropState.origH = cropState.h;
        }

        function onMove(e) {
            if (!cropState.dragging) return;
            e.preventDefault();
            const pos = getPos(e);
            const canvas = els.cropCanvas;
            const rect = canvas.getBoundingClientRect();

            // Convert pixel deltas to percentage of displayed canvas
            const dx = (pos.x - cropState.startX) / rect.width;
            const dy = (pos.y - cropState.startY) / rect.height;
            const minSize = 0.05; // 5% minimum

            if (cropState.dragging === 'move') {
                cropState.x = Math.max(0, Math.min(1 - cropState.w, cropState.origX + dx));
                cropState.y = Math.max(0, Math.min(1 - cropState.h, cropState.origY + dy));
            } else if (cropState.dragging === 'top-left') {
                const newX = Math.max(0, cropState.origX + dx);
                const newY = Math.max(0, cropState.origY + dy);
                cropState.w = Math.max(minSize, cropState.origW - (newX - cropState.origX));
                cropState.h = Math.max(minSize, cropState.origH - (newY - cropState.origY));
                cropState.x = cropState.origX + cropState.origW - cropState.w;
                cropState.y = cropState.origY + cropState.origH - cropState.h;
            } else if (cropState.dragging === 'top-right') {
                const newY = Math.max(0, cropState.origY + dy);
                cropState.w = Math.max(minSize, Math.min(1 - cropState.x, cropState.origW + dx));
                cropState.h = Math.max(minSize, cropState.origH - (newY - cropState.origY));
                cropState.y = cropState.origY + cropState.origH - cropState.h;
            } else if (cropState.dragging === 'bottom-left') {
                const newX = Math.max(0, cropState.origX + dx);
                cropState.w = Math.max(minSize, cropState.origW - (newX - cropState.origX));
                cropState.h = Math.max(minSize, Math.min(1 - cropState.y, cropState.origH + dy));
                cropState.x = cropState.origX + cropState.origW - cropState.w;
            } else if (cropState.dragging === 'bottom-right') {
                cropState.w = Math.max(minSize, Math.min(1 - cropState.x, cropState.origW + dx));
                cropState.h = Math.max(minSize, Math.min(1 - cropState.y, cropState.origH + dy));
            }

            updateCropBox();
        }

        function onEnd() {
            cropState.dragging = null;
        }

        box.addEventListener('mousedown', (e) => { if (e.target === box) onStart(e, 'move'); });
        box.addEventListener('touchstart', (e) => { if (e.target === box) onStart(e, 'move'); });

        handles.forEach(handle => {
            const classes = handle.className;
            let type = 'move';
            if (classes.includes('top-left')) type = 'top-left';
            else if (classes.includes('top-right')) type = 'top-right';
            else if (classes.includes('bottom-left')) type = 'bottom-left';
            else if (classes.includes('bottom-right')) type = 'bottom-right';

            handle.addEventListener('mousedown', (e) => onStart(e, type));
            handle.addEventListener('touchstart', (e) => onStart(e, type));
        });

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd);
    }

    function applyCrop() {
        // cropState is in percentages (0-1), map directly to editor canvas pixels
        const sx = cropState.x * els.editorCanvas.width;
        const sy = cropState.y * els.editorCanvas.height;
        const sw = cropState.w * els.editorCanvas.width;
        const sh = cropState.h * els.editorCanvas.height;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = sw;
        tempCanvas.height = sh;
        tempCanvas.getContext('2d').drawImage(els.editorCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

        state.originalImage = tempCanvas.toDataURL('image/jpeg', 0.95);
        state.rotation = 0;
        els.cropModal.classList.add('hidden');
        renderEditor();
        showToast('Crop applied');
    }

    // ==================== Export PDF ====================

    function openExportModal() {
        els.exportModal.classList.remove('hidden');
        els.exportPageCount.textContent = state.pages.length;

        // Reset radio visual states
        $$('.radio-option').forEach(opt => {
            const input = opt.querySelector('input');
            opt.classList.toggle('active', input.checked);
        });
    }

    async function exportPDF() {
        if (!state.pages.length) {
            showToast('No pages to export');
            return;
        }

        let jsPDFClass;
        try {
            jsPDFClass = window.jspdf.jsPDF;
        } catch (e) {
            showToast('PDF library not loaded. Check your internet connection.');
            return;
        }

        const name = els.pdfName.value.trim() || 'Scanned Document';
        const pageSize = document.querySelector('input[name="pageSize"]:checked').value;
        const orientation = document.querySelector('input[name="orientation"]:checked').value;
        const quality = document.querySelector('input[name="quality"]:checked').value;

        const qualityMap = { low: 0.5, medium: 0.75, high: 0.92 };
        const jpegQuality = qualityMap[quality];
        const maxDim = quality === 'high' ? 3000 : quality === 'medium' ? 2000 : 1200;

        els.exportModal.classList.add('hidden');
        showLoading('Generating PDF...');

        // Use setTimeout to let the UI update before heavy processing
        await new Promise(r => setTimeout(r, 100));

        try {
            const pdf = new jsPDFClass({ orientation, unit: 'mm', format: pageSize });

            for (let i = 0; i < state.pages.length; i++) {
                if (i > 0) pdf.addPage();
                els.loadingText.textContent = `Processing page ${i + 1}/${state.pages.length}...`;
                await new Promise(r => setTimeout(r, 50));

                const img = await loadImage(state.pages[i].fullImage);
                const pageWidth = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();
                const margin = 5;
                const availW = pageWidth - margin * 2;
                const availH = pageHeight - margin * 2;

                const imgRatio = img.width / img.height;
                const pageRatio = availW / availH;

                let drawW, drawH;
                if (imgRatio > pageRatio) {
                    drawW = availW;
                    drawH = availW / imgRatio;
                } else {
                    drawH = availH;
                    drawW = availH * imgRatio;
                }

                const x = margin + (availW - drawW) / 2;
                const y = margin + (availH - drawH) / 2;

                // Always re-render through canvas to ensure consistent JPEG format
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = Math.round(img.width * scale);
                tmpCanvas.height = Math.round(img.height * scale);
                tmpCanvas.getContext('2d').drawImage(img, 0, 0, tmpCanvas.width, tmpCanvas.height);
                const imgData = tmpCanvas.toDataURL('image/jpeg', jpegQuality);

                pdf.addImage(imgData, 'JPEG', x, y, drawW, drawH);
            }

            pdf.save(`${name}.pdf`);
            hideLoading();
            showToast('PDF saved successfully!');
        } catch (err) {
            hideLoading();
            showToast('Failed to generate PDF: ' + err.message);
            console.error('Export error:', err);
        }
    }

    // ==================== Event Listeners ====================

    // Main actions
    $('#btnCapture').addEventListener('click', openCamera);
    $('#btnGallery').addEventListener('click', () => els.fileInput.click());
    $('#btnExport').addEventListener('click', openExportModal);
    els.fileInput.addEventListener('change', (e) => {
        handleFileUpload(e.target.files);
        e.target.value = '';
    });

    // Camera
    $('#btnCameraClose').addEventListener('click', closeCamera);
    $('#btnSnap').addEventListener('click', capturePhoto);
    $('#btnSwitchCamera').addEventListener('click', switchCamera);
    $('#btnFlash').addEventListener('click', () => {
        state.flashOn = !state.flashOn;
        $('#btnFlash').querySelector('i').style.color = state.flashOn ? '#FFD700' : '';
        if (state.cameraStream) {
            const track = state.cameraStream.getVideoTracks()[0];
            if (track.getCapabilities && track.getCapabilities().torch) {
                track.applyConstraints({ advanced: [{ torch: state.flashOn }] });
            } else {
                showToast('Flash not supported');
            }
        }
    });
    $('#btnBatchMode').addEventListener('click', () => {
        state.batchMode = !state.batchMode;
        $('#btnBatchMode').querySelector('i').style.color = state.batchMode ? '#4ADE80' : '';
        showToast(state.batchMode ? 'Batch mode ON' : 'Batch mode OFF');
    });

    // Editor
    $('#btnEditorBack').addEventListener('click', () => {
        els.editorView.classList.add('hidden');
    });
    $('#btnEditorDone').addEventListener('click', saveEditorResult);

    // Filters
    $$('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentFilter = btn.dataset.filter;
            renderEditor();
        });
    });

    // Tools
    $('#btnDeskew').addEventListener('click', autoDeskew);

    $('#btnRotateLeft').addEventListener('click', () => {
        state.rotation = (state.rotation - 90 + 360) % 360;
        renderEditor();
    });

    $('#btnCrop').addEventListener('click', openCrop);

    let currentSliderMode = null;

    $('#btnBrightness').addEventListener('click', () => {
        currentSliderMode = 'brightness';
        els.sliderLabel.textContent = 'Brightness';
        els.adjustSlider.value = state.brightness;
        els.sliderValue.textContent = state.brightness;
        els.sliderPanel.classList.remove('hidden');
    });

    $('#btnContrast').addEventListener('click', () => {
        currentSliderMode = 'contrast';
        els.sliderLabel.textContent = 'Contrast';
        els.adjustSlider.value = state.contrast;
        els.sliderValue.textContent = state.contrast;
        els.sliderPanel.classList.remove('hidden');
    });

    els.adjustSlider.addEventListener('input', () => {
        const val = +els.adjustSlider.value;
        els.sliderValue.textContent = val;
        if (currentSliderMode === 'brightness') {
            state.brightness = val;
        } else {
            state.contrast = val;
        }
        renderEditor();
    });

    $('#btnSliderClose').addEventListener('click', () => {
        els.sliderPanel.classList.add('hidden');
    });

    // Crop
    $('#btnCropCancel').addEventListener('click', () => els.cropModal.classList.add('hidden'));
    $('#btnCropApply').addEventListener('click', applyCrop);

    $$('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.cropRatio = btn.dataset.ratio;

            if (state.cropRatio !== 'free') {
                const [rw, rh] = state.cropRatio.split(':').map(Number);
                const canvas = els.cropCanvas;
                const rect = canvas.getBoundingClientRect();
                const canvasAspect = rect.width / rect.height;
                const targetRatio = rw / rh;
                const maxPct = 0.9;

                if (canvasAspect > targetRatio) {
                    cropState.h = maxPct;
                    cropState.w = maxPct * targetRatio / canvasAspect;
                } else {
                    cropState.w = maxPct;
                    cropState.h = maxPct * canvasAspect / targetRatio;
                }
                cropState.x = (1 - cropState.w) / 2;
                cropState.y = (1 - cropState.h) / 2;
                updateCropBox();
            }
        });
    });

    initCropHandlers();

    // Export modal
    $('#btnModalClose').addEventListener('click', () => els.exportModal.classList.add('hidden'));
    $$('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', function() {
            this.closest('.modal').classList.add('hidden');
        });
    });

    $$('.radio-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const group = opt.closest('.radio-group');
            group.querySelectorAll('.radio-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            opt.querySelector('input').checked = true;
        });
    });

    $('#btnExportPdf').addEventListener('click', exportPDF);
    $('#btnSharePdf').addEventListener('click', async () => {
        if (!navigator.share) {
            showToast('Sharing not supported on this browser');
            return;
        }

        let jsPDFClass;
        try {
            jsPDFClass = window.jspdf.jsPDF;
        } catch (e) {
            showToast('PDF library not loaded');
            return;
        }

        const name = els.pdfName.value.trim() || 'Scanned Document';
        els.exportModal.classList.add('hidden');
        showLoading('Preparing to share...');

        try {
            const pdf = new jsPDFClass({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            for (let i = 0; i < state.pages.length; i++) {
                if (i > 0) pdf.addPage();
                const img = await loadImage(state.pages[i].fullImage);
                const pw = pdf.internal.pageSize.getWidth() - 10;
                const ph = pdf.internal.pageSize.getHeight() - 10;
                const r = Math.min(pw / img.width, ph / img.height);
                const w = img.width * r;
                const h = img.height * r;

                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = Math.min(img.width, 2000);
                tmpCanvas.height = Math.round(tmpCanvas.width * (img.height / img.width));
                tmpCanvas.getContext('2d').drawImage(img, 0, 0, tmpCanvas.width, tmpCanvas.height);
                const imgData = tmpCanvas.toDataURL('image/jpeg', 0.75);

                pdf.addImage(imgData, 'JPEG', 5 + (pw - w) / 2, 5 + (ph - h) / 2, w, h);
            }

            const blob = pdf.output('blob');
            const file = new File([blob], `${name}.pdf`, { type: 'application/pdf' });
            await navigator.share({ files: [file], title: name });
            hideLoading();
        } catch (err) {
            hideLoading();
            if (err.name !== 'AbortError') {
                showToast('Share failed: ' + err.message);
            }
        }
    });

    // Window resize handler for crop
    window.addEventListener('resize', () => {
        if (!els.cropModal.classList.contains('hidden')) {
            updateCropBox();
        }
    });

    // Initialize
    updateUI();
})();
