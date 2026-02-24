// State
let raiders = [];
let cubeAssignments = {
    FL: { main: null, backup: null },
    FR: { main: null, backup: null },
    BL: { main: null, backup: null },
    BR: { main: null, backup: null },
    BM: { main: null, backup: null }
};

let currentImportFormat = 'names';
const MAP_UNDERLAY_STORAGE_KEY = 'magtheridonMapUnderlayImage';
const CALIBRATED_POSITIONS_KEY = 'magtheridonCalibratedPositions';

// Calibration state
let calibrationMode = false;
let cubePositions = {
    FL: { x: 245, y: 205 }, // Default positions (center of cube)
    FR: { x: 555, y: 205 },
    BL: { x: 245, y: 505 },
    BR: { x: 555, y: 505 },
    BM: { x: 400, y: 645 }
};
let draggedCube = null;
let dragOffset = { x: 0, y: 0 };

// Cube configuration
const cubes = ['FL', 'FR', 'BL', 'BR', 'BM'];
const cubeNames = {
    FL: 'Front Left Cube',
    FR: 'Front Right Cube',
    BL: 'Back Left Cube',
    BR: 'Back Right Cube',
    BM: 'Back Middle Cube'
};

// Initialize
function init() {
    loadFromStorage();
    loadCalibratedPositions();
    setupEventListeners();
    updateRaiderDropdowns();
    renderRaiderList();
    updateRaiderCount();
    updateCubePositions();
    updateCubeVisuals();
}

// Event listeners
function setupEventListeners() {
    // Manual add
    document.getElementById('manualAddBtn').addEventListener('click', () => {
        document.getElementById('manualAddForm').style.display = 'block';
        document.getElementById('bulkImportForm').style.display = 'none';
    });
    
    document.getElementById('cancelAddBtn').addEventListener('click', () => {
        document.getElementById('manualAddForm').style.display = 'none';
        document.getElementById('raiderName').value = '';
    });
    
    document.getElementById('addRaiderBtn').addEventListener('click', addRaider);
    
    // Bulk import
    document.getElementById('bulkImportBtn').addEventListener('click', () => {
        document.getElementById('bulkImportForm').style.display = 'block';
        document.getElementById('manualAddForm').style.display = 'none';
    });
    
    document.getElementById('cancelImportBtn').addEventListener('click', () => {
        document.getElementById('bulkImportForm').style.display = 'none';
    });
    
    document.getElementById('importBtn').addEventListener('click', bulkImport);
    
    // Clear all
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    
    // Export
    document.getElementById('exportBtn').addEventListener('click', exportSetup);
    document.getElementById('generateShareLinkBtn').addEventListener('click', generateShareLink);
    
    // Format tabs
    document.querySelectorAll('.format-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentImportFormat = e.target.dataset.format;
            
            // Hide all help texts
            document.querySelectorAll('.format-help').forEach(help => help.style.display = 'none');
            
            // Show relevant help
            if (currentImportFormat === 'csv') {
                document.getElementById('csvFormatHelp').style.display = 'block';
                document.getElementById('bulkImportText').placeholder = 'Example:\nPlayer1\nPlayer2\nPlayer3';
            } else {
                document.getElementById('namesFormatHelp').style.display = 'block';
                document.getElementById('bulkImportText').placeholder = 'Example:\nPlayer1\nPlayer2\nPlayer3';
            }
        });
    });
    
    // Cube assignment dropdowns
    cubes.forEach(cube => {
        document.getElementById(`cube${cube}Main`).addEventListener('change', (e) => {
            cubeAssignments[cube].main = e.target.value || null;
            updateRaiderDropdowns();
            updateCubeVisuals();
            saveToStorage();
        });
        
        document.getElementById(`cube${cube}Backup`).addEventListener('change', (e) => {
            cubeAssignments[cube].backup = e.target.value || null;
            updateRaiderDropdowns();
            updateCubeVisuals();
            saveToStorage();
        });
    });
    
    // Enter key support
    document.getElementById('raiderName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addRaider();
    });
    
    // Map controls
    document.getElementById('showMapUnderlay').addEventListener('change', toggleMapUnderlayVisibility);
    document.getElementById('uploadMapBtn').addEventListener('click', () => {
        document.getElementById('mapImageInput').click();
    });
    document.getElementById('mapImageInput').addEventListener('change', handleMapImageUpload);
    
    // Calibration controls
    document.getElementById('calibrateBtn').addEventListener('click', enableCalibrationMode);
    document.getElementById('saveCalibrationBtn').addEventListener('click', saveCalibratedPositions);
    document.getElementById('cancelCalibrationBtn').addEventListener('click', disableCalibrationMode);
    
    // Load saved map and positions from localStorage
    const savedMap = localStorage.getItem(MAP_UNDERLAY_STORAGE_KEY);
    if (savedMap) {
        setMapUnderlay(savedMap, false);
    }
    loadCalibratedPositions();
    
    // Load from URL if present
    const urlParams = new URLSearchParams(window.location.search);
    const shareData = urlParams.get('data');
    if (shareData) {
        try {
            const data = JSON.parse(decodeURIComponent(shareData));
            loadFromData(data);
        } catch (e) {
            console.error('Failed to load share data:', e);
        }
    }
}

// Add raider
function addRaider() {
    const nameInput = document.getElementById('raiderName');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('Please enter a raider name');
        return;
    }
    
    if (raiders.find(r => r.name.toLowerCase() === name.toLowerCase())) {
        alert('Raider with this name already exists');
        return;
    }
    
    raiders.push({
        id: Date.now(),
        name: name
    });
    
    nameInput.value = '';
    document.getElementById('manualAddForm').style.display = 'none';
    
    updateRaiderDropdowns();
    renderRaiderList();
    updateRaiderCount();
    saveToStorage();
}

// Bulk import
function bulkImport() {
    const text = document.getElementById('bulkImportText').value.trim();
    
    if (!text) {
        alert('Please enter raider data');
        return;
    }
    
    const lines = text.split('\n');
    let imported = 0;
    
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        
        let name;
        
        if (currentImportFormat === 'names') {
            name = trimmed;
        } else {
            // CSV format - just take the first part (name)
            const parts = trimmed.split(',');
            name = parts[0].trim();
        }
        
        if (name && !raiders.find(r => r.name.toLowerCase() === name.toLowerCase())) {
            raiders.push({
                id: Date.now() + imported,
                name: name
            });
            imported++;
        }
    });
    
    document.getElementById('bulkImportForm').style.display = 'none';
    document.getElementById('bulkImportText').value = '';
    
    updateRaiderDropdowns();
    renderRaiderList();
    updateRaiderCount();
    saveToStorage();
    
    if (imported > 0) {
        alert(`Imported ${imported} raider(s)`);
    }
}

// Update raider dropdowns
function updateRaiderDropdowns() {
    cubes.forEach(cube => {
        const mainSelect = document.getElementById(`cube${cube}Main`);
        const backupSelect = document.getElementById(`cube${cube}Backup`);
        
        // Store current selections
        const currentMain = mainSelect.value;
        const currentBackup = backupSelect.value;
        
        // Clear and rebuild options
        mainSelect.innerHTML = '<option value="">-- Select Main --</option>';
        backupSelect.innerHTML = '<option value="">-- Select Backup --</option>';
        
        raiders.forEach(raider => {
            // Add to main dropdown if not assigned as main to another cube
            const isMainElsewhere = Object.entries(cubeAssignments).some(
                ([cubeKey, assign]) => cubeKey !== cube && assign.main === raider.id.toString()
            );
            
            if (!isMainElsewhere || currentMain === raider.id.toString()) {
                const option = document.createElement('option');
                option.value = raider.id;
                option.textContent = raider.name;
                if (currentMain === raider.id.toString()) {
                    option.selected = true;
                }
                mainSelect.appendChild(option);
            }
            
            // Add to backup dropdown if not assigned as backup to another cube
            const isBackupElsewhere = Object.entries(cubeAssignments).some(
                ([cubeKey, assign]) => cubeKey !== cube && assign.backup === raider.id.toString()
            );
            
            if (!isBackupElsewhere || currentBackup === raider.id.toString()) {
                const option = document.createElement('option');
                option.value = raider.id;
                option.textContent = raider.name;
                if (currentBackup === raider.id.toString()) {
                    option.selected = true;
                }
                backupSelect.appendChild(option);
            }
        });
    });
}

// Render raider list
function renderRaiderList() {
    const container = document.getElementById('raiderListContainer');
    container.innerHTML = '';
    
    if (raiders.length === 0) {
        container.innerHTML = '<p style="color: #718096; text-align: center; padding: 20px;">No raiders imported yet</p>';
        return;
    }
    
    raiders.forEach(raider => {
        const item = document.createElement('div');
        item.className = 'raider-item';
        
        // Check if assigned to any cube
        let assignmentInfo = '';
        cubes.forEach(cube => {
            if (cubeAssignments[cube].main === raider.id.toString()) {
                assignmentInfo += `Main: ${cubeNames[cube]} | `;
            }
            if (cubeAssignments[cube].backup === raider.id.toString()) {
                assignmentInfo += `Backup: ${cubeNames[cube]} | `;
            }
        });
        
        if (assignmentInfo) {
            assignmentInfo = assignmentInfo.slice(0, -3); // Remove last " | "
        }
        
        item.innerHTML = `
            <div class="raider-info">
                <div class="raider-name">${raider.name}</div>
                ${assignmentInfo ? `<div class="raider-position">${assignmentInfo}</div>` : ''}
            </div>
            <div class="raider-actions">
                <button onclick="removeRaider(${raider.id})" class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;">Remove</button>
            </div>
        `;
        
        container.appendChild(item);
    });
}

// Remove raider
function removeRaider(id) {
    if (confirm('Remove this raider? They will be unassigned from any cubes.')) {
        // Remove from cube assignments
        cubes.forEach(cube => {
            if (cubeAssignments[cube].main === id.toString()) {
                cubeAssignments[cube].main = null;
            }
            if (cubeAssignments[cube].backup === id.toString()) {
                cubeAssignments[cube].backup = null;
            }
        });
        
        raiders = raiders.filter(r => r.id !== id);
        updateRaiderDropdowns();
        renderRaiderList();
        updateRaiderCount();
        updateCubeVisuals();
        saveToStorage();
    }
}

// Update raider count
function updateRaiderCount() {
    document.getElementById('raiderCount').textContent = raiders.length;
}

// Update cube visuals on map
function updateCubeVisuals() {
    cubes.forEach(cube => {
        const cubeGroup = document.getElementById(`cube${cube}`);
        if (!cubeGroup) return;
        
        const outerCircle = cubeGroup.querySelector('.cube-outer');
        const hasMain = cubeAssignments[cube].main !== null;
        const hasBackup = cubeAssignments[cube].backup !== null;
        
        // Get cube position (use calibrated if available)
        const pos = cubePositions[cube] || { x: 245, y: 205 };
        
        // Update colors based on assignment status
        if (hasMain && hasBackup) {
            // Both assigned - green
            outerCircle.setAttribute('fill', '#00ff00');
            outerCircle.setAttribute('stroke', '#00cc00');
            outerCircle.setAttribute('stroke-width', '3');
        } else if (hasMain || hasBackup) {
            // One assigned - orange
            outerCircle.setAttribute('fill', '#ffaa00');
            outerCircle.setAttribute('stroke', '#ff8800');
            outerCircle.setAttribute('stroke-width', '2');
        } else {
            // Unassigned - blue
            outerCircle.setAttribute('fill', '#00bfff');
            outerCircle.setAttribute('stroke', '#0066cc');
            outerCircle.setAttribute('stroke-width', '2');
        }
        
        // Update tooltip
        let tooltipText = cubeNames[cube];
        if (hasMain) {
            const mainRaider = raiders.find(r => r.id.toString() === cubeAssignments[cube].main);
            tooltipText += `\nMain: ${mainRaider ? mainRaider.name : 'Unknown'}`;
        }
        if (hasBackup) {
            const backupRaider = raiders.find(r => r.id.toString() === cubeAssignments[cube].backup);
            tooltipText += `\nBackup: ${backupRaider ? backupRaider.name : 'Unknown'}`;
        }
        outerCircle.setAttribute('title', tooltipText);
        
        // Remove existing assignment text
        const existingTexts = cubeGroup.querySelectorAll('.assignment-text');
        existingTexts.forEach(text => text.remove());
        
        // Add assignment text if assigned
        if (hasMain || hasBackup) {
            const mainRaider = hasMain ? raiders.find(r => r.id.toString() === cubeAssignments[cube].main) : null;
            const backupRaider = hasBackup ? raiders.find(r => r.id.toString() === cubeAssignments[cube].backup) : null;
            
            const radius = 30;
            const baseY = pos.y + radius + 8;
            
            // Create text element for main
            if (mainRaider) {
                const mainText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                mainText.setAttribute('class', 'assignment-text');
                mainText.setAttribute('x', pos.x);
                mainText.setAttribute('y', baseY);
                mainText.setAttribute('text-anchor', 'middle');
                mainText.setAttribute('fill', '#ffd700');
                mainText.setAttribute('font-size', '11');
                mainText.setAttribute('font-weight', 'bold');
                mainText.setAttribute('filter', 'drop-shadow(0 0 3px rgba(0, 0, 0, 0.9))');
                mainText.textContent = `M: ${mainRaider.name}`;
                cubeGroup.appendChild(mainText);
            }
            
            // Create text element for backup
            if (backupRaider) {
                const backupText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                backupText.setAttribute('class', 'assignment-text');
                backupText.setAttribute('x', pos.x);
                backupText.setAttribute('y', baseY + 16);
                backupText.setAttribute('text-anchor', 'middle');
                backupText.setAttribute('fill', '#ffd700');
                backupText.setAttribute('font-size', '11');
                backupText.setAttribute('font-weight', 'bold');
                backupText.setAttribute('filter', 'drop-shadow(0 0 3px rgba(0, 0, 0, 0.9))');
                backupText.textContent = `B: ${backupRaider.name}`;
                cubeGroup.appendChild(backupText);
            }
        }
        
        // Ensure cube is positioned correctly
        updateSingleCubePosition(cube);
    });
}

// Clear all
function clearAll() {
    if (confirm('Clear all raiders and cube assignments? This cannot be undone.')) {
        raiders = [];
        cubes.forEach(cube => {
            cubeAssignments[cube] = { main: null, backup: null };
        });
        updateRaiderDropdowns();
        renderRaiderList();
        updateRaiderCount();
        updateCubeVisuals();
        saveToStorage();
    }
}

// Export setup
function exportSetup() {
    const data = {
        raiders: raiders,
        cubeAssignments: cubeAssignments,
        version: '1.0'
    };
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'magtheridon-setup.json';
    a.click();
    URL.revokeObjectURL(url);
}

// Generate share link
function generateShareLink() {
    const data = {
        raiders: raiders,
        cubeAssignments: cubeAssignments
    };
    
    const encoded = encodeURIComponent(JSON.stringify(data));
    const url = `${window.location.origin}${window.location.pathname}?data=${encoded}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(url).then(() => {
        alert('Share link copied to clipboard!\n\nShare this link with your raid team.');
    }).catch(() => {
        // Fallback: show in prompt
        prompt('Share this link with your raid team:', url);
    });
}

// Load from data
function loadFromData(data) {
    if (data.raiders) {
        raiders = data.raiders;
    }
    if (data.cubeAssignments) {
        cubeAssignments = data.cubeAssignments;
    }
    updateRaiderDropdowns();
    renderRaiderList();
    updateRaiderCount();
    updateCubeVisuals();
    saveToStorage();
}

// Save to storage
function saveToStorage() {
    const data = {
        raiders: raiders,
        cubeAssignments: cubeAssignments
    };
    localStorage.setItem('magtheridonData', JSON.stringify(data));
}

// Load from storage
function loadFromStorage() {
    const saved = localStorage.getItem('magtheridonData');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.raiders) {
                raiders = data.raiders;
            }
            if (data.cubeAssignments) {
                cubeAssignments = data.cubeAssignments;
            }
        } catch (e) {
            console.error('Failed to load from storage:', e);
        }
    }
}

// Coordinate conversion functions
function getMapImageBounds() {
    const underlay = document.getElementById('mapUnderlay');
    const mapStage = document.querySelector('.map-stage');
    
    if (!underlay.complete || !mapStage) {
        return null;
    }
    
    // Get the actual displayed size of the image (after object-fit: contain)
    const stageRect = mapStage.getBoundingClientRect();
    const imgAspect = underlay.naturalWidth / underlay.naturalHeight;
    const stageAspect = stageRect.width / stageRect.height;
    
    let displayedWidth, displayedHeight, offsetX, offsetY;
    
    if (imgAspect > stageAspect) {
        // Image is wider - fit to width
        displayedWidth = stageRect.width;
        displayedHeight = stageRect.width / imgAspect;
        offsetX = 0;
        offsetY = (stageRect.height - displayedHeight) / 2;
    } else {
        // Image is taller - fit to height
        displayedWidth = stageRect.height * imgAspect;
        displayedHeight = stageRect.height;
        offsetX = (stageRect.width - displayedWidth) / 2;
        offsetY = 0;
    }
    
    return {
        naturalWidth: underlay.naturalWidth,
        naturalHeight: underlay.naturalHeight,
        displayedWidth: displayedWidth,
        displayedHeight: displayedHeight,
        offsetX: offsetX,
        offsetY: offsetY,
        stageWidth: stageRect.width,
        stageHeight: stageRect.height
    };
}

function calculateMapToSVGCoordinates(mapX, mapY) {
    const bounds = getMapImageBounds();
    if (!bounds) {
        // Fallback to direct coordinates if map not loaded
        return { x: mapX, y: mapY };
    }
    
    // Convert map image coordinates to SVG viewBox coordinates (0-800)
    const scaleX = bounds.displayedWidth / bounds.naturalWidth;
    const scaleY = bounds.displayedHeight / bounds.naturalHeight;
    
    // Map coordinates are relative to the displayed image
    const svgX = ((mapX - bounds.offsetX) / scaleX) * (800 / bounds.naturalWidth);
    const svgY = ((mapY - bounds.offsetY) / scaleY) * (800 / bounds.naturalHeight);
    
    return { x: svgX, y: svgY };
}

function calculateSVGToMapCoordinates(svgX, svgY) {
    const bounds = getMapImageBounds();
    if (!bounds) {
        return { x: svgX, y: svgY };
    }
    
    // Convert SVG viewBox coordinates to map image coordinates
    const scaleX = bounds.displayedWidth / bounds.naturalWidth;
    const scaleY = bounds.displayedHeight / bounds.naturalHeight;
    
    const mapX = (svgX / 800) * bounds.naturalWidth * scaleX + bounds.offsetX;
    const mapY = (svgY / 800) * bounds.naturalHeight * scaleY + bounds.offsetY;
    
    return { x: mapX, y: mapY };
}

// Calibration mode functions
function enableCalibrationMode() {
    calibrationMode = true;
    document.getElementById('calibrationInfo').style.display = 'block';
    document.getElementById('calibrateBtn').textContent = 'Calibrating...';
    document.getElementById('calibrateBtn').disabled = true;
    
    // Make cubes draggable
    cubes.forEach(cube => {
        const cubeGroup = document.getElementById(`cube${cube}`);
        if (cubeGroup) {
            cubeGroup.classList.add('calibrating');
            cubeGroup.style.cursor = 'move';
        }
    });
    
    // Add drag event listeners
    setupCubeDragHandlers();
}

function disableCalibrationMode() {
    calibrationMode = false;
    document.getElementById('calibrationInfo').style.display = 'none';
    document.getElementById('calibrateBtn').textContent = 'Calibrate Positions';
    document.getElementById('calibrateBtn').disabled = false;
    
    // Remove draggable styling
    cubes.forEach(cube => {
        const cubeGroup = document.getElementById(`cube${cube}`);
        if (cubeGroup) {
            cubeGroup.classList.remove('calibrating');
            cubeGroup.style.cursor = '';
        }
    });
    
    // Remove drag event listeners
    removeCubeDragHandlers();
    
    // Restore positions from saved calibration
    loadCalibratedPositions();
    updateCubePositions();
}

let dragHandlersAttached = false;

function setupCubeDragHandlers() {
    if (dragHandlersAttached) return;
    
    cubes.forEach(cube => {
        const cubeGroup = document.getElementById(`cube${cube}`);
        if (!cubeGroup) return;
        
        cubeGroup.addEventListener('mousedown', (e) => handleCubeDragStart(e, cube));
    });
    
    document.addEventListener('mousemove', handleCubeDragMove);
    document.addEventListener('mouseup', handleCubeDragEnd);
    
    dragHandlersAttached = true;
}

function removeCubeDragHandlers() {
    if (!dragHandlersAttached) return;
    
    cubes.forEach(cube => {
        const cubeGroup = document.getElementById(`cube${cube}`);
        if (!cubeGroup) return;
        
        // Remove all event listeners by cloning the node
        const newGroup = cubeGroup.cloneNode(true);
        cubeGroup.parentNode.replaceChild(newGroup, cubeGroup);
    });
    
    // Note: We can't easily remove the document-level listeners, but they check calibrationMode
    dragHandlersAttached = false;
}

function handleCubeDragStart(e, cubeId) {
    if (!calibrationMode) return;
    e.preventDefault();
    
    draggedCube = cubeId;
    const cubeGroup = document.getElementById(`cube${cubeId}`);
    const svg = document.getElementById('magtheridonMap');
    const svgRect = svg.getBoundingClientRect();
    
    // Get current position
    const currentPos = cubePositions[cubeId];
    
    // Calculate offset from mouse to cube center
    const mouseX = e.clientX - svgRect.left;
    const mouseY = e.clientY - svgRect.top;
    
    // Convert SVG coordinates to viewBox coordinates
    const viewBoxX = (mouseX / svgRect.width) * 800;
    const viewBoxY = (mouseY / svgRect.height) * 800;
    
    dragOffset.x = viewBoxX - currentPos.x;
    dragOffset.y = viewBoxY - currentPos.y;
}

function handleCubeDragMove(e) {
    if (!calibrationMode || !draggedCube) return;
    e.preventDefault();
    
    const cubeGroup = document.getElementById(`cube${draggedCube}`);
    if (!cubeGroup) return;
    
    const svg = document.getElementById('magtheridonMap');
    if (!svg) return;
    
    const svgRect = svg.getBoundingClientRect();
    
    // Get mouse position relative to SVG
    const mouseX = e.clientX - svgRect.left;
    const mouseY = e.clientY - svgRect.top;
    
    // Convert to viewBox coordinates (800x800)
    const viewBoxX = (mouseX / svgRect.width) * 800;
    const viewBoxY = (mouseY / svgRect.height) * 800;
    
    // Update position (subtract offset to keep cube centered on cursor)
    cubePositions[draggedCube] = {
        x: Math.max(30, Math.min(770, viewBoxX - dragOffset.x)),
        y: Math.max(30, Math.min(770, viewBoxY - dragOffset.y))
    };
    
    // Update cube position
    updateSingleCubePosition(draggedCube);
}

function handleCubeDragEnd(e) {
    if (!calibrationMode || !draggedCube) return;
    
    draggedCube = null;
    dragOffset = { x: 0, y: 0 };
}

function updateSingleCubePosition(cubeId) {
    const cubeGroup = document.getElementById(`cube${cubeId}`);
    if (!cubeGroup) return;
    
    const pos = cubePositions[cubeId];
    const radius = 30;
    const innerSize = 30;
    
    // Update outer circle
    const outerCircle = cubeGroup.querySelector('.cube-outer');
    if (outerCircle) {
        outerCircle.setAttribute('cx', pos.x);
        outerCircle.setAttribute('cy', pos.y);
    }
    
    // Update inner rect
    const innerRect = cubeGroup.querySelector('.cube-inner');
    if (innerRect) {
        innerRect.setAttribute('x', pos.x - innerSize / 2);
        innerRect.setAttribute('y', pos.y - innerSize / 2);
    }
    
    // Update label text
    const labelText = cubeGroup.querySelector('.cube-label');
    if (labelText) {
        labelText.setAttribute('x', pos.x);
        labelText.setAttribute('y', pos.y + 5);
    }
    
    // Update assignment text if it exists
    const assignmentTexts = cubeGroup.querySelectorAll('.assignment-text');
    assignmentTexts.forEach(text => {
        const currentY = parseFloat(text.getAttribute('y'));
        const baseY = pos.y + radius + 5;
        if (text.textContent.startsWith('M:')) {
            text.setAttribute('x', pos.x);
            text.setAttribute('y', baseY);
        } else if (text.textContent.startsWith('B:')) {
            text.setAttribute('x', pos.x);
            text.setAttribute('y', baseY + 14);
        }
    });
}

function updateCubePositions() {
    cubes.forEach(cube => {
        updateSingleCubePosition(cube);
    });
}

function saveCalibratedPositions() {
    const mapImage = document.getElementById('mapUnderlay');
    const mapSrc = mapImage.src;
    
    const data = {
        positions: cubePositions,
        mapSrc: mapSrc,
        timestamp: Date.now()
    };
    
    localStorage.setItem(CALIBRATED_POSITIONS_KEY, JSON.stringify(data));
    alert('Cube positions saved!');
    disableCalibrationMode();
}

function loadCalibratedPositions() {
    const saved = localStorage.getItem(CALIBRATED_POSITIONS_KEY);
    if (!saved) return;
    
    try {
        const data = JSON.parse(saved);
        const mapImage = document.getElementById('mapUnderlay');
        
        // Only load if the map source matches
        if (data.mapSrc && mapImage.src && mapImage.src === data.mapSrc && data.positions) {
            cubePositions = data.positions;
            updateCubePositions();
        } else if (data.positions && !mapImage.src) {
            // Load positions even if map not loaded yet (will be applied when map loads)
            cubePositions = data.positions;
        }
    } catch (e) {
        console.error('Failed to load calibrated positions:', e);
    }
}

// Map underlay functions
function setMapUnderlay(src, persist) {
    const underlay = document.getElementById('mapUnderlay');
    const dimmer = document.getElementById('mapUnderlayDimmer');

    underlay.onload = () => {
        if (persist) {
            localStorage.setItem(MAP_UNDERLAY_STORAGE_KEY, src);
        }
        toggleMapUnderlayVisibility();
        // Recalculate cube positions when map loads
        loadCalibratedPositions();
        updateCubePositions();
    };

    underlay.onerror = () => {
        underlay.style.display = 'none';
        dimmer.style.display = 'none';
    };

    underlay.src = src;
}

function toggleMapUnderlayVisibility() {
    const showUnderlay = document.getElementById('showMapUnderlay').checked;
    const underlay = document.getElementById('mapUnderlay');
    const dimmer = document.getElementById('mapUnderlayDimmer');
    const hasImage = underlay.complete && underlay.naturalWidth > 0;

    underlay.style.display = showUnderlay && hasImage ? 'block' : 'none';
    dimmer.style.display = showUnderlay && hasImage ? 'block' : 'none';
}

function handleMapImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const dataUrl = event.target.result;
        setMapUnderlay(dataUrl, true);
    };
    reader.readAsDataURL(file);
    
    // Reset input so same file can be selected again
    e.target.value = '';
}

// Initialize on load
init();
