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
        } catch (err) {
            showToast('Camera access denied');
            closeCamera();
        }
    }

    function closeCamera() {
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

    function capturePhoto() {
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
            addPage(dataURL);
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
            reader.onload = (e) => {
                processed++;
                if (fileArray.length > 1) {
                    addPage(e.target.result);
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
        };
        img.src = dataURL;
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

    function saveEditorResult() {
        const canvas = els.editorCanvas;
        const dataURL = canvas.toDataURL('image/jpeg', 0.92);

        if (state.currentPageIndex >= 0) {
            const page = state.pages[state.currentPageIndex];
            page.fullImage = dataURL;
            page.filter = state.currentFilter;
            page.brightness = state.brightness;
            page.contrast = state.contrast;
            page.rotation = state.rotation;

            // Update thumbnail
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
            addPage(dataURL);
        }

        els.editorView.classList.add('hidden');
        updateUI();
        showToast('Page saved');
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
        const { jsPDF } = window.jspdf;
        const name = els.pdfName.value.trim() || 'Scanned Document';
        const pageSize = document.querySelector('input[name="pageSize"]:checked').value;
        const orientation = document.querySelector('input[name="orientation"]:checked').value;
        const quality = document.querySelector('input[name="quality"]:checked').value;

        const qualityMap = { low: 0.5, medium: 0.75, high: 0.92 };
        const jpegQuality = qualityMap[quality];

        els.exportModal.classList.add('hidden');
        showLoading('Generating PDF...');

        try {
            const pdf = new jsPDF({ orientation, unit: 'mm', format: pageSize });

            for (let i = 0; i < state.pages.length; i++) {
                if (i > 0) pdf.addPage();
                els.loadingText.textContent = `Processing page ${i + 1}/${state.pages.length}...`;

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

                pdf.addImage(state.pages[i].fullImage, 'JPEG', x, y, drawW, drawH, undefined, 'FAST', 0);
            }

            pdf.save(`${name}.pdf`);
            hideLoading();
            showToast('PDF saved successfully!');
        } catch (err) {
            hideLoading();
            showToast('Failed to generate PDF');
            console.error(err);
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
    $('.modal-overlay').addEventListener('click', function() {
        this.closest('.modal').classList.add('hidden');
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

        const { jsPDF } = window.jspdf;
        const name = els.pdfName.value.trim() || 'Scanned Document';
        els.exportModal.classList.add('hidden');
        showLoading('Preparing to share...');

        try {
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            for (let i = 0; i < state.pages.length; i++) {
                if (i > 0) pdf.addPage();
                const img = await loadImage(state.pages[i].fullImage);
                const pw = pdf.internal.pageSize.getWidth() - 10;
                const ph = pdf.internal.pageSize.getHeight() - 10;
                const r = Math.min(pw / img.width, ph / img.height);
                const w = img.width * r;
                const h = img.height * r;
                pdf.addImage(state.pages[i].fullImage, 'JPEG', 5 + (pw - w) / 2, 5 + (ph - h) / 2, w, h);
            }

            const blob = pdf.output('blob');
            const file = new File([blob], `${name}.pdf`, { type: 'application/pdf' });
            await navigator.share({ files: [file], title: name });
            hideLoading();
        } catch (err) {
            hideLoading();
            if (err.name !== 'AbortError') {
                showToast('Share failed');
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
